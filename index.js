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
    console.log("onIntent requestId=" + intentRequest.requestId +
        ", sessionId=" + session.sessionId);

    var intent = intentRequest.intent,
        intentName = intentRequest.intent.name;

    // Dispatch to your skill's intent handlers
    if ("GmailIntent" === intentName) {
        // setColorInSession(intent, session, callback);
    } else if ("WhatsMyColorIntent" === intentName) {
        // getColorFromSession(intent, session, callback);
    } else if ("AMAZON.HelpIntent" === intentName) {
        getWelcomeResponse(callback);
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
    // Add cleanup logic here
}

// --------------- Functions that control the skill's behavior -----------------------

function getWelcomeResponse(session, callback) {
    var customerId = session.user.userId;
    // If we wanted to initialize the session to have some attributes we could add those here.
    var sessionAttributes = {};
    var cardTitle = "Welcome to Gmail on Alexa. ";
    var cardOutput = "";
    var speechOutput = "Hello, welcome to Gmail on Alexa. ";
    // If the user either does not reply to the welcome message or says something that is not
    // understood, they will be prompted again with this text.
    var repromptText = "Reprompt text";
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
                url = url + '&state=' + customerId;
                speechOutput = "Welcome to Gmail on Alexa. Please link your Gmail account using your companion app. ";
                cardTitle = "Welcome to Gmail on Alexa. Click the link to associate your Gmail account with Alexa. ";
                cardOutput = url;

                callback(sessionAttributes,
                    buildSpeechletResponse(cardTitle, cardOutput, speechOutput, repromptText, shouldEndSession));
            }
            else {
                console.log('Auth tokens were found in the data store: ' + JSON.stringify(tokens, null, '  '));
                oauth2Client.setCredentials(tokens.Item.AUTH_TOKENS);
                gmail.users.labels.list({ userId: 'me', auth: oauth2Client, fields: ['labels/name, labels/id'] }, function (err, response) {
                    if (err) {
                        console.log('Failed to fetch labels for the user: ' + err);
                        // Fail here.
                    }
                    else {
                        var labels = response.labels;
                        if (labels.length == 0) {
                            console.log('No labels found.');
                            speechOutput += 'You do not have labels in your Gmail account. '
                        } else {
                            speechOutput += 'Here are your labels. '
                            console.log('Labels: ');
                            for (var i = 0; i < labels.length; i++) {
                                var label = labels[i];
                                console.log('%s - %s', label.name, label.id);
                                speechOutput += label.name + '. ';
                            }

                            callback(sessionAttributes,
                                buildSpeechletResponse(cardTitle, cardOutput, speechOutput, repromptText, shouldEndSession));
                        }
                    }
                });
            }
        }
    });
}

// --------------- Helpers that build all of the responses -----------------------
function buildSpeechletResponse(cardTitle, cardOutput, speechOutput, repromptText, shouldEndSession) {
    return {
        outputSpeech: {
            type: "PlainText",
            text: speechOutput
        },
        card: {
            type: "Simple",
            title: cardTitle,
            content: cardOutput
        },
        reprompt: {
            outputSpeech: {
                type: "PlainText",
                text: repromptText
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

function isEmptyObject(obj) {
    for (var key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            return false;
        }
    }
    return true;
}