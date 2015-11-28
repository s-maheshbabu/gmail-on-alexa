var grunt = require('grunt');
grunt.loadNpmTasks('grunt-aws-lambda');

grunt.initConfig({
    lambda_invoke: {
        default: {
            options: {
                // file_name: 'link-gmail-account-with-alexa.js'
                file_name: 'index.js'
            }
        }
    },
    lambda_deploy: {
        default: {
            arn: 'arn:aws:lambda:us-east-1:837603326872:function:gmail-on-alexa'
            // arn: 'arn:aws:lambda:us-east-1:837603326872:function:Test_GMailOnAlexa_Test'
        }
    },
    lambda_package: {
        default: {
        }
    }
});

grunt.registerTask('deploy', ['lambda_package', 'lambda_deploy']);
