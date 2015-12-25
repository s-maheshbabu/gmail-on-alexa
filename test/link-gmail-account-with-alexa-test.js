var expect = require("chai").expect;
var mockery = require('mockery');
var unitUnderTest = require('../src/link-gmail-account-with-alexa.js');

describe('Array', function () {
    before(function() {
        mockery.enable(); // Enable mockery at the start of your test suite
    });

    beforeEach(function() {
        mockery.registerMock('./node_modules/googleapis/lib/googleapis.js', googlemock);    // Register others to be replaced with our stub
    });

    afterEach(function() {
        mockery.deregisterAll();    // Deregister all Mockery mocks from node's module cache
    });

    after(function() {
        mockery.disable(); // Disable Mockery after tests are completed
    });

    describe('#indexOf()', function () {
        it('should return -1 when the value is not present', function () {
            expect([1, 2, 3].indexOf(5)).to.equal(-1);
            expect([1, 2, 3].indexOf(2)).to.equal(1);
        });
    });
});

var googlemock = {
    stat: function (path, cb) { /* your mock code */ }
};