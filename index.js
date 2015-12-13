var util = require('util');
var async = require("async");
var xmlescape = require('xml-escape');

var AWS = require('aws-sdk');
AWS.config.update({ region: "us-east-1" });
var dynamodb = new AWS.DynamoDB.DocumentClient();

var google = require('./node_modules/googleapis/lib/googleapis.js');
var OAuth2Client = google.auth.OAuth2;
var gmail = google.gmail('v1');

var CLIENT_ID = '175453001188-nkr6j5ik5kc5f2rg8ns6emju48tojnsp.apps.googleusercontent.com';
var CLIENT_SECRET = 'JM2iWplt5_zC6iHPInmH3VYb';
var REDIRECT_URL = 'https://iz0thnltv7.execute-api.us-east-1.amazonaws.com/Prod/mydemoresource';
var oauth2Client = new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URL);

var AUTH_TABLE_NAME = "TestTable";

exports.handler = function (event, context) {
    try {
        console.log("event.session.application.applicationId=" + event.session.application.applicationId);
        if (event.session.application.applicationId !== "amzn1.echo-sdk-ams.app.8197c761-239b-49eb-aacd-0ead732763a9") {
            context.fail("Function invoked with an invalid Application ID: " + event.session.application.applicationId);
        }

        if (event.session.new) {
            onSessionStarted({ requestId: event.request.requestId }, event.session);
        }

        if (event.request.type === "LaunchRequest") {
            onLaunch(event.request,
                event.session,
                function callback(sessionAttributes, speechletResponse) {
                    console.log(buildResponse(sessionAttributes, speechletResponse));
                    context.succeed(buildResponse(sessionAttributes, speechletResponse));
                });
        } else if (event.request.type === "IntentRequest") {
            onIntent(event.request,
                event.session,
                function callback(sessionAttributes, speechletResponse) {
                    console.log(buildResponse(sessionAttributes, speechletResponse));
                    context.succeed(buildResponse(sessionAttributes, speechletResponse));
                });
        } else if (event.request.type === "SessionEndedRequest") {
            onSessionEnded(event.request, event.session);
            context.succeed();
        }
    } catch (e) {
        context.fail("Exception: " + e);
    }
};

/**
 * Called when the session starts.
 */
function onSessionStarted(sessionStartedRequest, session) {
    console.log("onSessionStarted requestId=" + sessionStartedRequest.requestId +
        ", sessionId=" + session.sessionId);
}

/**
 * Called when the user launches the skill without specifying what they want.
 */
function onLaunch(launchRequest, session, callback) {
    console.log("onLaunch requestId=" + launchRequest.requestId +
        ", sessionId=" + session.sessionId);

    // Dispatch to your skill's launch.
    getWelcomeResponse(session, callback);
}

/**
 * Called when the user specifies an intent for this skill.
 */
function onIntent(intentRequest, session, callback) {
    var intentName = intentRequest.intent.name;
    console.log("onIntent requestId=" + intentRequest.requestId +
        ", sessionId=" + session.sessionId + ", intentName=" +intentName );

    // Dispatch to your skill's intent handlers
    if ("GmailIntent" === intentName) {
        // setColorInSession(intent, session, callback);
    } else if ("AMAZON.HelpIntent" === intentName) {
        getWelcomeResponse(session, callback);
    } else if ("AMAZON.YesIntent" === intentName) {
        startReadingUnreadMessages(session, callback);
    } else {
        throw "Invalid intent";
    }
}

/**
 * Called when the user ends the session.
 * Is not called when the skill returns shouldEndSession=true.
 */
function onSessionEnded(sessionEndedRequest, session) {
    console.log("onSessionEnded requestId=" + sessionEndedRequest.requestId +
        ", sessionId=" + session.sessionId);
}

// --------------- Functions that control the skill's behavior -----------------------

function startReadingUnreadMessages(session, callback) {
    var speechOutput = "<speak> I shouldn't have said that. </speak>";
    var repromptText = "<speak> I shouldn't have said that. </speak>";
    var cardTitle = "";
    var cardOutput = "";
    var shouldEndSession = true;

    var sessionAttributes = session.attributes;
    if(!sessionAttributes || !sessionAttributes.messages || sessionAttributes.messages.length == 0) {
        throw "Unexpected state. Session should contain the messages to be read. " + session;
    }
    var messages = sessionAttributes.messages;

// TODO: Remove: In real flow, this won't be needed because oauth client is already initiatlized.
oauth2Client.setCredentials({refresh_token: '1/OHPGZ2wimSfCUKN_Js4SWBvBqENuG2s_VuPoqEhw7fTBactUREZofsF9C7PrpE-j'});

    var asyncTasks = [];
    messages.forEach(function (message) {
        asyncTasks.push(function (callback) {
            gmail.users.messages.get({ auth: oauth2Client, userId: 'me', id: message.id, format: 'metadata', metadataHeaders: ['From', 'Subject'], fields: ['id, payload, snippet'] }, function (err, r) {
                callback(null, r);
            });
        });
    });

    async.parallel(asyncTasks, function (err, messagesWithMetadata) {
        if (err) {
            console.log("Error fetching messages.");
            if (err.code == 400 || err.code == 403) {
                speechOutput = "<speak> Sorry, am not able to access your gmail. This can happen if you revoked my access to your gmail account. </speak>";
                repromptText = "";
                cardOutput = "Sorry, am not able to access your gmail. This can happen if you revoked my access to your gmail account.";
                callback(sessionAttributes,
                    buildSpeechletResponse(cardTitle, cardOutput, speechOutput, repromptText, shouldEndSession));
            }
            if (err.code == 402) {
                // This could be because the tokens expired. Need to figure out how to save fresh access token in database.
            }
            // Generic error message.
        }
        else {
            speechOutput = '<speak> ';
            messagesWithMetadata.forEach(function (messageWithMetadata) {
                var sender = fetchHeader(messageWithMetadata.payload.headers, 'From').value.replace(/ *\<[^>]*\> */g, "");
                speechOutput += xmlescape(fetchHeader(messageWithMetadata.payload.headers, 'Subject').value) + '. <break time="300ms"/> ' +
                // TODO: Removing the email address. However, if a name is not available, we should use the email address.
                'From: ' + (isEmptyObject(sender) ? 'Unknown Sender' : xmlescape(sender)) + '. <audio src="https://s3-us-west-2.amazonaws.com/gmail-on-alexa/message-end.mp3" /> '
                // xmlescape(messageWithMetadata.snippet) + ' <audio src="https://s3-us-west-2.amazonaws.com/gmail-on-alexa/message-end.mp3" />';
            });
            speechOutput += " </speak> ";

            callback(sessionAttributes,
                buildSpeechletResponse(cardTitle, cardOutput, speechOutput, repromptText, shouldEndSession));
        }
    });
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

function getWelcomeResponse(session, callback) {
    var customerId = session.user.userId;
    // If we wanted to initialize the session to have some attributes we could add those here.
    var sessionAttributes = session.attributes;
    var cardTitle = "Welcome to Gmail on Alexa. ";
    var cardOutput = "";
    var speechOutput = "<speak> I shouldn't have said that. </speak>";
    var repromptText = "<speak> I shouldn't have said that. </speak>";
    var shouldEndSession = true;

    dynamodb.get({
        "TableName": AUTH_TABLE_NAME,
        Key: {
            "CID": customerId
        }
    }, function (err, tokens) {
        if (err) {
            console.log('ERROR: Reading auth tokens from dynamo failed: ' + err);
            // Fail here.
        } else {
            if (isEmptyObject(tokens)) {
                console.log('No auth tokens found. New user. ');

                var url = oauth2Client.generateAuthUrl({
                    access_type: 'offline', // will return a refresh token
                    scope: 'https://www.googleapis.com/auth/gmail.readonly' // can be a space-delimited string or an array of scopes
                });
                url = url + '&state=' + customerId + '&approval_prompt=force';
                speechOutput = "<speak> Welcome to Gmail on Alexa. Please link your Gmail account using the link I added in your companion app.  </speak>";
                cardTitle = "Welcome to Gmail on Alexa. Click the link to associate your Gmail account with Alexa. ";
                cardOutput = url;

                callback(sessionAttributes,
                    buildSpeechletResponse(cardTitle, cardOutput, speechOutput, repromptText, shouldEndSession));
            }
            else {
                console.log('Auth tokens were found in the data store: ' + JSON.stringify(tokens, null, '  '));
                oauth2Client.setCredentials({refresh_token: tokens.Item.REFRESH_TOKEN});
                gmail.users.messages.list({ userId: 'me', auth: oauth2Client, maxResults: 4, q: 'is:unread after:1448982179'/* + tokens.Item.LCD */}, function (err, response) {
                    if (err) {
                        console.log('Failed to fetch messages for the user: ' + util.inspect(err, false, null));
                        if(err.code == 400 || err.code == 403) {
                            speechOutput = "<speak> Sorry, am not able to access your gmail. This can happen if you revoked my access to your gmail account. </speak>";
                            cardOutput = "Sorry, am not able to access your gmail. This can happen if you revoked my access to your gmail account.";
                            callback(sessionAttributes,
                                        buildSpeechletResponse(cardTitle, cardOutput, speechOutput, repromptText, shouldEndSession));
                        }
                        if(err.code == 402) {
                            // This could be because the tokens expired. Need to figure out how to save fresh access token in database.
                        }
                        // Generic error message.
                    }
                    else {
                        var numberOfMessages = 0;
                        if(response && response.messages) {
                            numberOfMessages = response.messages.length;
                        }
                        if (numberOfMessages > 0) {
                            shouldEndSession = false;
                            speechOutput = '<speak> You have ' + response.messages.length + ' unread messages since the last time I checked. Do you want me to start reading them? </speak>';
                            repromptText = '<speak> There are ' + response.messages.length + ' unread messages. I can read the summaries. Should I start reading? </speak>';
                            console.log('You have ' + util.inspect(response.messages, false, null) + ' unread messages since the last time I checked. Do you want me to start reading them?');

                            sessionAttributes = persistMessagesInCache(sessionAttributes, response.messages, response.nextPageToken != undefined);
                        }

                        dynamodb.update({
                            "TableName": AUTH_TABLE_NAME,
                            'Key': { "CID": customerId },
                            'ExpressionAttributeValues': { ":last_checked_date": Math.floor(((new Date).getTime() / 1000)) },
                            'ExpressionAttributeNames': { "#proxyName": "LCD" },
                            'UpdateExpression': 'set #proxyName = :last_checked_date'
                        }, function (err, tokens) {
                            if (err) console.log('Last checked date was not saved to the database' + util.inspect(err, false, null));
                            else console.log('Last checked date successfully updated in database');

                            // Return the response irrespective of whether or not the last_checked_date update succeeded.
                            callback(sessionAttributes,
                                            buildSpeechletResponse(cardTitle, cardOutput, speechOutput, repromptText, shouldEndSession));
                        });
                    }
                });
/* Labels code
                gmail.users.labels.list({ userId: 'me', auth: oauth2Client, fields: ['labels/id'] }, function (err, response) {
                    if (err) {
                        console.log('Failed to fetch labels for the user: ' + util.inspect(err, false, null));
                        if(err.code == 400 || err.code == 403) {
                            speechOutput = "Sorry, am not able to access your gmail. This can happen if you revoked my access to your gmail account.";
                            repromptText = "";
                            cardOutput = "Sorry, am not able to access your gmail. This can happen if you revoked my access to your gmail account.";
                            callback(sessionAttributes,
                                        buildSpeechletResponse(cardTitle, cardOutput, speechOutput, repromptText, shouldEndSession));
                        }
                        if(err.code == 402) {
                            // This could be because the tokens expired. Need to figure out how to save fresh access token in database.
                        }
                        // Generic error message.
                    }
                    else {
                        var labels = filterLabels(response.labels);
                        if (labels.length == 0) {
                            console.log('No labels found.');
                            speechOutput += 'You do not have labels in your Gmail account. '
                        } else {
                            var asyncTasks = [];
                            labels.forEach(function (label) {
                                asyncTasks.push(function (callback) {
                                    gmail.users.labels.get({ userId: 'me', id: label.id, auth: oauth2Client, fields: ['name, id, threadsUnread'] }, function (err, r) {
                                        callback(null, r);
                                    });
                                });
                            });

                            async.parallel(asyncTasks, function (err, labelsWithDetails) {
                                if (err) {
                                    console.log("Error fetching label details.");
                                    if(err.code == 400 || err.code == 403) {
                                        speechOutput = "Sorry, am not able to access your gmail. This can happen if you revoked my access to your gmail account.";
                                        repromptText = "";
                                        cardOutput = "Sorry, am not able to access your gmail. This can happen if you revoked my access to your gmail account.";
                                        callback(sessionAttributes,
                                                    buildSpeechletResponse(cardTitle, cardOutput, speechOutput, repromptText, shouldEndSession));
                                    }
                                    if(err.code == 402) {
                                        // This could be because the tokens expired. Need to figure out how to save fresh access token in database.
                                    }
                                    // Generic error message.
                                }
                                else {
                                    var orderedLabels = reorderLabels(labelsWithDetails);
                                    speechOutput = buildEmailInfoSpeechResponse(orderedLabels);

                                    dynamodb.update({
                                        "TableName": AUTH_TABLE_NAME,
                                        'Key': { "CID": customerId },
                                        'ExpressionAttributeValues': { ":last_checked_date": Math.floor(((new Date).getTime() / 1000)) },
                                        'ExpressionAttributeNames': { "#proxyName": "LCD" },
                                        'UpdateExpression': 'set #proxyName = :last_checked_date'
                                    }, function (err, tokens) {
                                        if (err) console.log('Last checked date was not saved to the database' + util.inspect(err, false, null));
                                        else console.log('Last checked date successfully updated in database');

                                        // Return the response irrespective of whether or not the last_checked_date update succeeded.
                                        callback(sessionAttributes,
                                            buildSpeechletResponse(cardTitle, cardOutput, speechOutput, repromptText, shouldEndSession));
                                    });
                                }
                            });
                        }
                    }
                });
*/
            }
        }
    });
}

// --------------- Helpers that build all of the responses -----------------------
function buildSpeechletResponse(cardTitle, cardOutput, speechOutput, repromptText, shouldEndSession) {
    return {
        outputSpeech: {
            type: "SSML",
            ssml: speechOutput
        },
        card: {
            type: "Simple",
            title: cardTitle,
            content: cardOutput
        },
        reprompt: {
            outputSpeech: {
                type: "SSML",
                ssml: repromptText
            }
        },
        shouldEndSession: shouldEndSession
    };
}

function buildResponse(sessionAttributes, speechletResponse) {
    return {
        version: "1.0",
        sessionAttributes: sessionAttributes,
        response: speechletResponse
    };
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

// --------------- Gmail specific utilities -----------------------
var INBOX_LABEL = "INBOX";
var CHAT_LABEL = "CHAT";
var DRAFT_LABEL = "DRAFT";
var DEFAULT_LABELS = ["CATEGORY_UPDATES", "CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL", "CATEGORY_FORUMS"];
var IRRELAVANT_LABELS = ["TRASH", "UNREAD", "IMPORTANT", "SENT", "STARRED", "SPAM", "CATEGORY_PERSONAL"];

var MAX_NUMBER_OF_LABELS_TO_READ = 3;
function buildEmailInfoSpeechResponse(labels) {
    if (labels.length == 0) {
        return 'You do not have labels in your Gmail account. '
    }

    // This iteration to gather labels with unread messages will make output response easier because we would
    // know when to use and when to use 'and', 'comma' etc.
    var labelsWithUnreadMessages = [];
    for (var i = 0; i < labels.length; i++) {
        if (labels[i].threadsUnread > 0) {
            labelsWithUnreadMessages.push(labels[i]);
        }
    }

    var speechOutput = '';
    var isFirstLabel = true;
    var numberOfLabelsRead = 0;
    var iterationStoppedAt = 0;
    if(labelsWithUnreadMessages.length === 0) {
        return 'You do not have any unread conversations.';
    }
    for (var i = 0; i < labelsWithUnreadMessages.length && numberOfLabelsRead < MAX_NUMBER_OF_LABELS_TO_READ; iterationStoppedAt = i, i++) {
        var label = labelsWithUnreadMessages[i];
        if (isFirstLabel) {
            speechOutput += 'You have ' + label.threadsUnread + ' unread ' + (label.threadsUnread === 1 ? 'conversation' : 'conversations') + ' in ' + friendlyNameForLabels(label) + (i === labelsWithUnreadMessages.length - 1 ? '. ' : '');
            isFirstLabel = false;
        } else {
            speechOutput += (i === labelsWithUnreadMessages.length - 1 ? ' and ' : ', ') + label.threadsUnread + ' in ' + friendlyNameForLabels(label) + (i === labelsWithUnreadMessages.length - 1 ? '' : '');
        }
        numberOfLabelsRead++;
    }

    var remainingUnreadConversationsCount = 0;
    for(iterationStoppedAt++; iterationStoppedAt < labelsWithUnreadMessages.length; iterationStoppedAt++) {
        remainingUnreadConversationsCount += labelsWithUnreadMessages[iterationStoppedAt].threadsUnread;
    }
    if (remainingUnreadConversationsCount > 0) {

        speechOutput += ' and ' + remainingUnreadConversationsCount + ' more in other labels. Do you want me to read them?';
    } else {
        speechOutput += '. Do you want me to read them?';
    }
    return speechOutput;
}
/**
 * Remove irrelavant labels like TRASH, SENT etc.
 */
function filterLabels(labels) {
    var relevantLabels = [];

    if (labels.length == 0) {
        console.log('No labels to be filtered.');
        return labels;
    } else {
        for (var i = 0; i < labels.length; i++) {
            var label = labels[i];
            if (IRRELAVANT_LABELS.indexOf(label.id) <= -1) {
                relevantLabels.push(label);
            }
        }
    }

    return relevantLabels;
}

/**
 * Arrange the labels in the order in which we want to deliver the results. For example,
 * Inbox should always go first.
 */
function reorderLabels(labels) {
    var orderedLabels = [];

    var inboxLabel, chatLabel, draftLabel;
    var defaultLabels = [];
    var customLabels = [];
    if (labels.length == 0) {
        console.log('No labels to be reordered.');
        return labels;
    } else {
        for (var i = 0; i < labels.length; i++) {
            var label = labels[i];

            if (INBOX_LABEL === label.id) {
                inboxLabel = label;
            }
            else if (CHAT_LABEL === label.id) {
                chatLabel = label;
            }
            else if (DRAFT_LABEL === label.id) {
                draftLabel = label;
            }
            else if (DEFAULT_LABELS.indexOf(label.id) > -1) {
                defaultLabels.push(label);
            }
            else {
                customLabels.push(label);
            }
        }
    }
    sortLabelsListByName(defaultLabels);
    sortLabelsListByName(customLabels);

    orderedLabels.push(inboxLabel);
    orderedLabels = orderedLabels.concat(customLabels);
    orderedLabels.push(chatLabel);
    orderedLabels.push(draftLabel);
    orderedLabels = orderedLabels.concat(defaultLabels);

    for (var i = 0; i < orderedLabels.length; i++) {
        console.log('%s (%s) - %s', orderedLabels[i].name, orderedLabels[i].id, orderedLabels[i].messagesUnread);
    }
    return orderedLabels;
}

/**
 * Sort labels by their name in increasing alphabetical order.
 */
function sortLabelsListByName(labelsList) {
    labelsList.sort(function(first, second){ if (first.name < second.name) {
    return -1;
    }
  if (first.name > second.name) {
    return 1;
  }
  return 0;
  });
}

/**
 * Provides a user friendly name that can replace the default
 * name for a label. We suggest user friendly names only for system labels
 * (which are created by Gmail) as against user labels.
 */
function friendlyNameForLabels(label) {
    if (DEFAULT_LABELS.indexOf(label.id) > -1) {
        if("CATEGORY_UPDATES" === label.id) {
            return "Updates";
        }
        else if("CATEGORY_PROMOTIONS" === label.id) {
            return "Promotions";
        }
        else if("CATEGORY_SOCIAL" === label.id) {
            return "Social Media";
        }
        else if("CATEGORY_FORUMS" === label.id) {
            return "Online Forums";
        }
    }
    return label.name;
}

function persistMessagesInCache(sessionAttributes, messages, isMoreMessagesExist) {
    if(sessionAttributes) {
        sessionAttributes.messages = messages;
        sessionAttributes.isMoreMessagesExist = isMoreMessagesExist;
        return sessionAttributes;
    }
    return {
        messages: messages,
        isMoreMessagesExist: isMoreMessagesExist
    };
}