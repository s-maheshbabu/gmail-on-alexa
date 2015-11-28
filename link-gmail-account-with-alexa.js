var AWS = require('aws-sdk');
AWS.config.update({ region: "us-east-1" });
var dynamodb = new AWS.DynamoDB.DocumentClient();

var google = require('./node_modules/googleapis/lib/googleapis.js');
var OAuth2Client = google.auth.OAuth2;
var gmail = google.gmail('v1');

var CLIENT_ID = '175453001188-nkr6j5ik5kc5f2rg8ns6emju48tojnsp.apps.googleusercontent.com';
var CLIENT_SECRET = 'JM2iWplt5_zC6iHPInmH3VYb';
var REDIRECT_URL = 'https://iz0thnltv7.execute-api.us-east-1.amazonaws.com/Prod/mydemoresource';
// var REDIRECT_URL = 'https://example.com/Prod/mydemoresource';

var oauth2Client = new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URL);

var AUTH_TABLE_NAME = "TestTable";

exports.handler = function (event, context) {
    console.log("Request received:\n", JSON.stringify(event));

    if (!event.code || !event.state) {
        console.log("Unexpected error. Either authentication code or state not found");
        context.fail("Sorry, unable to link your Gmail account with Alexa. Please try again later.");
    }
    else {
        fetchAndPersistTokens(event.code, event.state, persistTokens);
    }

    function fetchAndPersistTokens(code, customerId, callback) {
        oauth2Client.getToken(code, function (err, tokens) {
            if (err) {
                console.log('Failed to fetch oauth tokens: ' + err);
                context.fail("Sorry, unable to link your Gmail account with Alexa. Please try again later.");
            } else {
                console.log("Tokens obtained from Google: " + JSON.stringify(tokens, null, '  '));
                callback(tokens, customerId,
                    function callback() {
                        context.succeed("Successfully persisted authentication tokens in the data store.");
                    });
            }
        });
    }

    function persistTokens(tokens, customerId, callback) {
        dynamodb.put({
            "TableName": AUTH_TABLE_NAME,
            "Item": {
                "CID": customerId,
                "AUTH_TOKENS": tokens
            }
        }, function (err, tokens) {
            if (err) {
                console.log('ERROR: Storing auth tokens in dynamo failed: ' + err);
                context.fail("Sorry, unable to link your Gmail account with Alexa. Please try again later.");
            } else {
                console.log('Auth tokens stored successfully in dynamo: ' + JSON.stringify(tokens, null, '  '));
                callback();
            }
        });
    }

    // retrieve an access token 
    function listLabels(oauth2Client) {    
        // retrieve user profile
        gmail.users.labels.list({ userId: 's.maheshbabu@gmail.com', auth: oauth2Client }, function (err, response) {
            if (err) {
                console.log('An error occured trying to fetch Gmail labels', err); return;
                context.succeed('FAILURE');
            }
            var labels = response.labels;
            if (labels.length == 0) {
                console.log('No labels found.');
            } else {
                console.log('Labels:');
                for (var i = 0; i < labels.length; i++) {
                    var label = labels[i];
                    console.log('- %s', label.name);
                }
            }
            context.succeed('SUCCESS');
        });
    };
};