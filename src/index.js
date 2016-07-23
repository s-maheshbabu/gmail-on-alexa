var util = require('util');
var async = require("async");
var xmlescape = require('xml-escape');
var Q = require('q');
var AlexaSkill = require('./AlexaSkill');
var dateFormat = require('dateformat');

var AWS = require('aws-sdk');
AWS.config.update({ region: "us-east-1" });
var dynamodb = new AWS.DynamoDB.DocumentClient();

var google = require('../node_modules/googleapis/lib/googleapis.js');
var OAuth2Client = google.auth.OAuth2;
var gmail = google.gmail('v1');

var CLIENT_ID = '175453001188-nkr6j5ik5kc5f2rg8ns6emju48tojnsp.apps.googleusercontent.com';
var CLIENT_SECRET = 'JM2iWplt5_zC6iHPInmH3VYb';

var oauth2Client = new OAuth2Client(CLIENT_ID, CLIENT_SECRET);

var GMAIL_ON_ALEXA_CUSTOMER_PREFERENCES_TABLE_NAME = "GMAIL_ON_ALEXA_CUSTOMER_PREFERENCES";
var MESSAGES_PER_TURN = 4;
var NEW_MESSAGES_PROMPT_THRESHOLD = 4;
var UNREAD_MESSAGES_PROMPT_THRESHOLD = 10;

var ALL_UNREAD_MESSAGES_QUERY = 'is:unread';

var APP_ID = "amzn1.echo-sdk-ams.app.8197c761-239b-49eb-aacd-0ead732763a9";
var GmailOnAlexa = function () {
    AlexaSkill.call(this, APP_ID);
};

GmailOnAlexa.prototype = Object.create(AlexaSkill.prototype);
GmailOnAlexa.prototype.constructor = GmailOnAlexa;

exports.handler = function (event, context) {
    var skill = new GmailOnAlexa();
    skill.execute(event, context);
};

/**
 * Called when the user launches the skill without specifying what they want.
 */
GmailOnAlexa.prototype.eventHandlers.onLaunch = function(launchRequest, session, response) {
    console.log("onLaunch requestId=" + launchRequest.requestId +
        ", sessionId=" + session.sessionId);

    // Dispatch to your skill's launch.
    getWelcomeResponse(session, response);
}


GmailOnAlexa.prototype.intentHandlers = {
    "GmailIntent": function (intent, session, response) {
        getWelcomeResponse(session, response);
    },

    "AMAZON.YesIntent": function (intent, session, response) {
        continueReadingMoreMessages(session, response);
    },

    "AMAZON.NoIntent": function (intent, session, response) {
        exitSkill(response);
    },

    "AMAZON.StopIntent": function (intent, session, response) {
        exitSkill(response);
    },

    "AMAZON.CancelIntent": function (intent, session, response) {
        exitSkill(response);
    },

    // TODO: If user says help amidst a message reading session, we should continue reading messages after help message.
    "AMAZON.HelpIntent": function (intent, session, response) {
        var helpMessage = 'I can read new messages on your email account, newest first. I remember the last time you asked me to check your email and will ' +
                        'only read the messages you received since. If there are no new unread messages, I can also read all of your unread messages irrespective ' +
                        'of when you received them. I just added different ways you can ask me to check your email in the companion app. ' +
                        'So, if you want me to check your inbox, just ask me to.';
        var helpMessageCard = 'I can read new messages on your email account, newest first. I remember the last time you asked me to check your email and will ' +
                'only read the messages you received since. If there are no new unread messages, I can also read all of your unread messages irrespective ' +
                'of when you received them. Here are a few ways you can ask me to check your email.\n' +
                '* check my inbox\n' +
                '* check if I have new mail\n' +
                '* read my latest messages\n';

        var speechOutput = {
            speech: helpMessage,
            type: AlexaSkill.speechOutputType.PLAIN_TEXT
        };
        response.askWithCard(speechOutput,
                            { speech: 'Say something like check my inbox if you want me to read your email', type: AlexaSkill.speechOutputType.PLAIN_TEXT },
                            { cardTitle: "Email Digest Skill Help", cardOutput: helpMessageCard });
    }
};

// --------------- Functions that control the skill's behavior -----------------------
var ResponseStrings = function () {
    this.speechText = "Alexa should never say this.";
    this.repromptText = "Alexa should never say this.";

    this.cardTitle = "Alexa should never say put this in the companion app.";
    this.cardOutput = "Alexa should never say put this in the companion app.";
    this.terminateSession = true;
}

function continueReadingMoreMessages(session, response) {
    var sessionAttributes = session.attributes;
    if (!sessionAttributes || !sessionAttributes.query || !sessionAttributes.accessToken) {
        throw "Unexpected state. Session should exist and be in a valid date. Session: " + util.inspect(sessionAttributes, { showHidden: true, depth: null });
    }
    var query = sessionAttributes.query;
    oauth2Client.setCredentials({ access_token: sessionAttributes.accessToken });

    var messagesResponsePromise;
    // Fetch next set of messages to be read
    if (sessionAttributes.messagesResponse.nextPageToken) {
        messagesResponsePromise = getMessages(sessionAttributes.messagesResponse.nextPageToken, query, MESSAGES_PER_TURN);
    }

    messagesResponsePromise.then(
        function (messagesResponse) {
            var deliverMessagesPromise = deliverMessages(messagesResponse, sessionAttributes);
            sessionAttributes = persistMessagesInCache(sessionAttributes, messagesResponse, query);
            return deliverMessagesPromise;
        }
        ).then(
        function (responseStrings) {
            if (responseStrings.terminateSession) {
                response.tell({ speech: responseStrings.speechText, type: AlexaSkill.speechOutputType.SSML });
            }
            else {
                response.ask({ speech: responseStrings.speechText, type: AlexaSkill.speechOutputType.SSML }, { speech: responseStrings.repromptText, type: AlexaSkill.speechOutputType.SSML });
            }
        },
        function (err) {
            console.log('Failed to fetch new messages for the user: ' + util.inspect(error, { showHidden: true, depth: null }));
            if (error.code == 401) {
                speechText = "Sorry, am not able to access your Gmail. I either never had access or it was revoked. Please try granting access using the link I put in the companion app.";
                response.tellWithCard({ speech: speechText, type: AlexaSkill.speechOutputType.PLAIN_TEXT }, { type: AlexaSkill.cardOutputType.LINK_ACCOUNT });
            }

            speechText = "Sorry, I am unable access your Gmail account. Please try later.";
            response.tell({ speech: speechText, type: AlexaSkill.speechOutputType.PLAIN_TEXT });
        }
        );
}

function deliverMessages(messagesResponse) {
    var deferred = Q.defer();
    var responseStrings = new ResponseStrings();
    var isEndOfMessages = true;

    if (!messagesResponse || !messagesResponse.messages || messagesResponse.messages.length == 0) {
        responseStrings.speechText = 'You have no more new messages.';
        responseStrings.repromptText = "";
        responseStrings.cardTitle = "";
        responseStrings.cardOutput = "";
        responseStrings.terminateSession = true;

        deferred.resolve(responseStrings);
        return deferred.promise;
    }

    var messages = messagesResponse.messages;
    var asyncTasks = [];
    messages.forEach(function (message) {
        asyncTasks.push(function (callback) {
            gmail.users.messages.get({ auth: oauth2Client, userId: 'me', id: message.id, format: 'metadata', metadataHeaders: ['From', 'Subject'], fields: ['id, payload, snippet'] }, function (err, r) {
                callback(err, r);
            });
        });
    });
    async.parallel(asyncTasks, function (err, messagesWithMetadata) {
        if (err) {
            deferred.reject(err);
        }
        else {
            var speechText = '';
            var repromptText = '';
            messagesWithMetadata.forEach(function (messageWithMetadata) {
                var sender = fetchHeader(messageWithMetadata.payload.headers, 'From').value.replace(/ *\<[^>]*\> */g, "");
                // TODO: Removing the email address. However, if a name is not available, we should use the email address.
                speechText += 'From: ' + ((!sender || 0 === sender.length) ? 'Unknown Sender' : xmlescape(sender)) + '. <break time="300ms"/> ' +
                xmlescape(fetchHeader(messageWithMetadata.payload.headers, 'Subject').value) + '. <audio src="https://s3-us-west-2.amazonaws.com/gmail-on-alexa/message-end.mp3" /> ';
            });
            if (messagesWithMetadata.length < MESSAGES_PER_TURN) {
                speechText += "You have no more new messages.";
                isEndOfMessages = true;
            }
            else {
                speechText += "Do you want me to continue reading?";
                repromptText = "There are more messages. Do you want me to continue reading?";
                isEndOfMessages = false;
            }
            speechText += " ";

            responseStrings.speechText = speechText;
            responseStrings.repromptText = repromptText;
            responseStrings.cardTitle = "";
            responseStrings.cardOutput = "";
            responseStrings.terminateSession = isEndOfMessages;

            deferred.resolve(responseStrings);
        }
    });

    return deferred.promise;
}

function exitSkill(response) {
    var speechOutput = '';
    response.tell(speechOutput);
}

function fetchHeader(headers, key) {
    if(headers.length == 0) {
        return undefined;
    }
    for(var i = 0; i < headers.length; i++) {
        if(headers[i].name === key) {
            return headers[i];
        }
    }
    return undefined;
}

var getMessages = function (nextPageToken, query, numberOfMessages) {
    var deferred = Q.defer();
    gmail.users.messages.list({ userId: 'me', auth: oauth2Client, maxResults: numberOfMessages, q: query, pageToken: nextPageToken }, function (err, response) {
        if (err) {
            deferred.reject(err);
        } else {
            deferred.resolve(response);
        }
    });
    return deferred.promise;
}

var getCustomerPreferences = function (customerId) {
    var deferred = Q.defer();
    dynamodb.get({
        "TableName": GMAIL_ON_ALEXA_CUSTOMER_PREFERENCES_TABLE_NAME,
        Key: {
            "CID": customerId
        }
    }, function (err, preferences) {
        if (err) {
            console.log('Error while fetching customer preferences for: ' + customerId + '. ' + util.inspect(err, { showHidden: true, depth: null }));
            deferred.reject(err);
        } else {
            // If preferences doesn't exist create an empty object to populate with defaults.
            if (isEmptyObject(preferences) || isEmptyObject(preferences.Item)) {
                preferences = {};
                preferences.Item = {};
            }
            // If just the LCD value doesn't exist, load the default value for it.
            if(preferences && preferences.Item && !preferences.Item.LCD)
            {
                // LastCheckedDate will be empty for new customers. We default it to 30 days ago.
                var aMonthAgo = new Date();
                aMonthAgo.setDate(new Date().getDate() - 30);
                preferences.Item.LCD = Math.floor(aMonthAgo.getTime() / 1000);
            }
            deferred.resolve(preferences);
        }
    });
    return deferred.promise;
}

/**
 * Updates the last checked date to the current time for the given customer. Any errors while updating the database
 * are logged and swallowed.
 */
var updateLCD = function (customerId) {
    var deferred = Q.defer();
    dynamodb.update({
        "TableName": GMAIL_ON_ALEXA_CUSTOMER_PREFERENCES_TABLE_NAME,
        'Key': { "CID": customerId },
        'ExpressionAttributeValues': { ":last_checked_date": Math.floor(((new Date).getTime() / 1000)) },
        'ExpressionAttributeNames': { "#proxyName": "LCD" },
        'UpdateExpression': 'set #proxyName = :last_checked_date'
    }, function (err, response) {
        if (err) {
            console.log('Last checked date was not saved to the database. Ignoring the error.' + util.inspect(err, { showHidden: true, depth: null }));
        } else {
            console.log('Last checked date successfully updated in database.');
        }
        deferred.resolve();
    });

    return deferred.promise;
}

function getWelcomeResponse(session, response) {
    var customerId = session.user.userId;
    // If we wanted to initialize the session to have some attributes we could add those here.
    var sessionAttributes = session.attributes;
    var cardTitle = "Welcome to Gmail on Alexa. ";
    var cardOutput = "Welcome to Gmail on Alexa. ";
    var speechText = "Alexa shouldn't have said that.";
    var repromptText = "Alexa shouldn't have said that.";
    var shouldEndSession = false;

    var accessToken = session.user.accessToken;
    var customerPreferencesPromise = getCustomerPreferences(customerId);
    var LCD = '';
    customerPreferencesPromise.then(
        function (customerPreferences) {
            console.log('Customer preferences were found in the data store: ' + JSON.stringify(customerPreferences, null, '  '));
            LCD = customerPreferences.Item.LCD;
        }, function (error) {
            console.log('Failed to fetch customer preferences from database: ' + util.inspect(error, { showHidden: true, depth: null }));
            speechText = "Sorry, I am unable to recall the last time I checked your Gmail. Please try later.";

            response.tell({ speech: speechText, type: AlexaSkill.speechOutputType.PLAIN_TEXT });
        })
        .then(
        function () {
            oauth2Client.setCredentials({ access_token: accessToken });
            sessionAttributes = persistAccessTokenInCache(sessionAttributes, accessToken);
            var query = ALL_UNREAD_MESSAGES_QUERY + ' after:' + LCD;/*'1450385000';*/

            var newMessagesPromise = getMessages(undefined, query, NEW_MESSAGES_PROMPT_THRESHOLD + 1);
            newMessagesPromise.then(
                function (messagesResponse) {
                    var numberOfMessages = 0;
                    if (messagesResponse && messagesResponse.messages) {
                        numberOfMessages = messagesResponse.messages.length;
                    }

                    if (numberOfMessages > 0) {
                        speechText = 'Your new' + (numberOfMessages === 1 ? (' message ') : ' messages ') + ' since the last time I checked. ';
                        cardOutput = "I found " + (numberOfMessages > NEW_MESSAGES_PROMPT_THRESHOLD ? ('more than ' + NEW_MESSAGES_PROMPT_THRESHOLD) : numberOfMessages) + ' new' + (numberOfMessages === 1 ? (' message ') : ' messages ') + ' since the last time I checked your messages at '
                            + dateFormat((new Date(LCD * 1000)), "h:MM:ss TT, mmmm dS") + '.';
                        console.log('You have ' + util.inspect(messagesResponse.messages, { showHidden: true, depth: null }) + ' new messages since the last time I checked at ' + dateFormat((new Date(LCD * 1000)), "h:MM:ss TT, mmmm dS"));

                        var deliverMessagesPromise = deliverMessages(messagesResponse);
                        deliverMessagesPromise.then(
                            function (responseStrings) {
                                speechText += responseStrings.speechText ? responseStrings.speechText : '';
                                repromptText = responseStrings.repromptText ? responseStrings.repromptText : '';
                                shouldEndSession = responseStrings.terminateSession;

                                sessionAttributes = persistMessagesInCache(sessionAttributes, messagesResponse, query);
                            }
                        );
                        return deliverMessagesPromise;
                    } else {
                        query = ALL_UNREAD_MESSAGES_QUERY;
                        var allUnreadMessagesPromise = getMessages(undefined, query, UNREAD_MESSAGES_PROMPT_THRESHOLD + 1);
                        allUnreadMessagesPromise.then(
                            function (messagesResponse) {
                                numberOfMessages = 0;
                                if (messagesResponse && messagesResponse.messages) {
                                    numberOfMessages = messagesResponse.messages.length;
                                }

                                if (numberOfMessages > 0) {
                                    speechText = 'You have no new messages since the last time I checked. However there are ' + (numberOfMessages > UNREAD_MESSAGES_PROMPT_THRESHOLD ? ('more than ' + UNREAD_MESSAGES_PROMPT_THRESHOLD) : numberOfMessages) + ' unread' + (numberOfMessages === 1 ? (' message ') : ' messages ') + ' in your account. Do you want me to start reading' + (numberOfMessages === 1 ? (' it ') : ' them ') + '?';
                                    repromptText = 'Although there aren\'t any new messages since the last time I checked at ' + dateFormat((new Date(LCD * 1000)), "h:MM TT") + ' on ' + dateFormat((new Date(LCD * 1000)), "mmmm dS") + ', there are ' +
                                        (numberOfMessages > UNREAD_MESSAGES_PROMPT_THRESHOLD ? ('more than ' + UNREAD_MESSAGES_PROMPT_THRESHOLD) : numberOfMessages) + ' unread' + (numberOfMessages === 1 ? (' message ') : ' messages ') + ' in your account in total. Do you want me to start reading?';
                                    cardOutput = 'I did not find any new messages since the last time I checked your messages at '
                                        + dateFormat((new Date(LCD * 1000)), "h:MM:ss TT, mmmm dS") + ' but found ' + (numberOfMessages > UNREAD_MESSAGES_PROMPT_THRESHOLD ? ('more than ' + UNREAD_MESSAGES_PROMPT_THRESHOLD) : numberOfMessages) +
                                        ' unread' + (numberOfMessages === 1 ? (' message') : ' messages') + ' in total in your account';

                                    // The above call is just to get the count of new messages. If the user wants us to
                                    // read the messages, we want to start from beginning and so setting nextPageToen to zero.
                                    // Optimizatin possible by using the results of the above calls to fetch messages.
                                    messagesResponse.nextPageToken = '0';
                                    sessionAttributes = persistMessagesInCache(sessionAttributes, messagesResponse, query);
                                }
                                else {
                                    speechText = 'There are no new messages since the last time I checked. In fact, there are no unread messages at all in your account. Awesome! You achieved inbox zero.';
                                    cardOutput = "There were no new messages since the last time I checked at "
                                        + dateFormat((new Date(LCD * 1000)), "h:MM:ss TT, mmmm dS") + "." +
                                        " In fact, there were no unread messages at all in your account. Awesome! You achieved inbox zero.";
                                    shouldEndSession = true;
                                }
                            });

                        return allUnreadMessagesPromise;
                    }
                },
                function (error) {
                    console.log('Failed to fetch new messages for the user: ' + util.inspect(error, { showHidden: true, depth: null }));
                    if (error.code == 401) {
                        speechText = "Sorry, am not able to access your Gmail. I either never had access or it was revoked. Please try granting access using the link I put in the companion app.";
                        response.tellWithCard({ speech: speechText, type: AlexaSkill.speechOutputType.PLAIN_TEXT }, { type: AlexaSkill.cardOutputType.LINK_ACCOUNT });
                    }

                    speechText = "Sorry, I am unable access your Gmail account. Please try later.";
                    response.tell({ speech: speechText, type: AlexaSkill.speechOutputType.PLAIN_TEXT });
                }
            )
                .then(
                function () {
                    // Whether or not to update LCD
                    if (query === ALL_UNREAD_MESSAGES_QUERY) {
                        return Q(false);
                    }
                    else {
                        return Q(true);
                    }
                },
                function (error) {
                    console.log('Failed to fetch new messages for the user: ' + util.inspect(error, { showHidden: true, depth: null }));
                    if (error.code == 401) {
                        speechText = "Sorry, am not able to access your Gmail. I either never had access or it was revoked. Please try granting access using the link I put in the companion app.";
                        response.tellWithCard({ speech: speechText, type: AlexaSkill.speechOutputType.PLAIN_TEXT }, { type: AlexaSkill.cardOutputType.LINK_ACCOUNT });
                    }

                    speechText = "Sorry, I am unable access your Gmail account. Please try later.";
                    response.tell({ speech: speechText, type: AlexaSkill.speechOutputType.PLAIN_TEXT });
                }
                )
                .then(
                function (updateLCDNeeded) {
                    if (updateLCDNeeded === true) {
                        console.log("Updating LCD...");
                        return updateLCD(customerId);
                    }
                    else {
                        console.log("Skipped LCD update.");
                        return Q(undefined);
                    }
                }
                )
                .then(
                function () {
                    // Return the response irrespective of whether or not the last_checked_date update succeeded.
                    if (!shouldEndSession) {
                        response.askWithCard({ speech: speechText, type: AlexaSkill.speechOutputType.SSML }, { speech: repromptText, type: AlexaSkill.speechOutputType.SSML }, { cardTitle: cardTitle, cardOutput: cardOutput });
                    } else {
                        response.tellWithCard({ speech: speechText, type: AlexaSkill.speechOutputType.SSML }, { cardTitle: cardTitle, cardOutput: cardOutput });
                    }
                },
                function (err) {
                    console.log('LCD update failures shouldn\'t get propagated and so we shouldn\'t have ever reached here. Error: ' + util.inspect(err, { showHidden: true, depth: null }));
                    // Generic error message.
                }
                )
        }
        );
}

// --------------- Utility Methods -----------------------
function isEmptyObject(obj) {
    for (var key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            return false;
        }
    }
    return true;
}

function persistAccessTokenInCache(sessionAttributes, accessToken) {
        if(sessionAttributes) {
        sessionAttributes.accessToken = accessToken;
        return sessionAttributes;
    }
    return {
        accessToken: accessToken
    };
}

function persistMessagesInCache(sessionAttributes, messagesResponse, query) {
    if(sessionAttributes) {
        sessionAttributes.messagesResponse = messagesResponse;
        sessionAttributes.query = query;
        return sessionAttributes;
    }
    return {
        messagesResponse: messagesResponse,
        query: query
    };
}