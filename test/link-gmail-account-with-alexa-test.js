var expect = require("chai").expect;
var mockery = require('mockery');
var sinon = require('sinon');

var unitUnderTest;

describe('link-gmail-account-with-alexa', function () {
    before(function () {
        // Enable mockery at the start of your test suite
        mockery.enable({
            warnOnReplace: false,
            warnOnUnregistered: false
        });
    });

    beforeEach(function() {
        mockery.registerMock('../node_modules/googleapis/lib/googleapis.js', googlemock);    // Register others to be replaced with our stub
        unitUnderTest = require('../src/link-gmail-account-with-alexa.js');
    });

    afterEach(function() {
        mockery.deregisterAll();    // Deregister all Mockery mocks from node's module cache
    });

    after(function () {
        mockery.disable(); // Disable Mockery after tests are completed
    });

    describe('malformed event object', function () {
        it('should fail when code is undefined', function () {
            var event = {code: undefined, state: 'somestate'};

            var callback = sinon.spy();
            var context = { fail: callback };

            unitUnderTest.handler(event, context);
            expect(callback.called).to.be.true;
        });

        it('should fail when code is empty', function () {
            var event = {code: '', state: 'somestate'};

            var callback = sinon.spy();
            var context = { fail: callback };

            unitUnderTest.handler(event, context);
            expect(callback.called).to.be.true;
        });

        it('should fail when code is null', function () {
            var event = {code: null, state: 'somestate'};

            var callback = sinon.spy();
            var context = { fail: callback };

            unitUnderTest.handler(event, context);
            expect(callback.called).to.be.true;
        });
    });

    describe('malformed state object', function () {
        it('should fail when state is undefined', function () {
            var event = {code: 'somecode', state: undefined};

            var callback = sinon.spy();
            var context = { fail: callback };

            unitUnderTest.handler(event, context);
            expect(callback.called).to.be.true;
        });

        it('should fail when state is empty', function () {
            var event = {code: 'somecode', state: ''};

            var callback = sinon.spy();
            var context = { fail: callback };

            unitUnderTest.handler(event, context);
            expect(callback.called).to.be.true;
        });

        it('should fail when state is null', function () {
            var event = {code: 'somecode', state: null};

            var callback = sinon.spy();
            var context = { fail: callback };

            unitUnderTest.handler(event, context);
            expect(callback.called).to.be.true;
        });
    });

    describe('fetching auth tokens from Google fails', function () {
        it('should fail', function () {
            var eventDoesntMatter = {code: 'somecode', state: 'somestate'};

            var callback = sinon.spy();
            var context = { fail: callback };

            unitUnderTest.handler(eventDoesntMatter, context);
            expect(callback.called).to.be.true;
        });
    });
});

var googlemock = {
    auth: {
        OAuth2: function (clientId, clientSecret, redirectUrl) {
                return {getToken: function (code, callback) {
                    console.log('getToken methods called on mock Google oauth2Client');
                    // Simulate an error when calling getToken
                    callback("ERROR", undefined);
            }};
        }
    }
};