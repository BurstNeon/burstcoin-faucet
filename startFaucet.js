var jsonMarkup = require('json-markup');
var jsonFormat = require('prettyjson');
var url = require('url');
var request = require('request');
var compression = require('compression');
var express = require('express');
var httpProxy = require('http-proxy');
var path = require('path');
var http = require('http');
var bodyParser = require('body-parser');
var io = require('socket.io')();
var ioSocket = null;
var RateLimit = require('express-rate-limit');
var lruRateLimit = require('ratelimit-lru');
var getJSON = require('get-json');
//new usage (express-recaptcha version >= 4.*.*)
var faucetConfig = require('./faucetConfig');
var Recaptcha = require('express-recaptcha').Recaptcha;
//import Recaptcha from 'express-recaptcha'
var recaptcha = new Recaptcha(faucetConfig.googlePublicKey, faucetConfig.googlePrivateKey);
var errorCode = ''
var errorMessage = '';

initWebserver();

function initWebserver() {
    var app = express();
    app.set('view engine', 'ejs');

    app.use(express.static(path.join(__dirname, 'client')));
    app.use(bodyParser.json());
    app.use(bodyParser.urlencoded({
        extended: true
    }));

    var createAccountLimiter = new RateLimit({
        windowMs: 24 * 60 * 60 * 1000, // 24 hours window
        delayAfter: faucetConfig.maxRequest * 3, // begin slowing down responses after certain value (Factor 3)
        delayMs: 3 * 1000, // slow down subsequent responses by 3 seconds per request
        max: faucetConfig.maxRequest * 3, // start blocking after certain value (Factor 3)
        message: "Too many account attempts from this IP, please try again after a day"
    });

    app.use(createAccountLimiter);
    app.get('/', function(req, res) {
        console.log("load");
        res.render('index', {
            error: 'post only method'
        })
    });

    app.post('/', createAccountLimiter, function(req, res) {
        console.log("1 | Requested Account: " + req.body.name);
        recaptcha.verify(req, function(error, data) {
            //TO-DO Change later
            if (error) {
                checkWallet(req.body.name);
            } else {
                console.log(error + "no");
                errorMessage = 'reCAPTCHA validation failed'
            }
        })
        res.render('index', {
            error: errorMessage
        });
    });

    app.use(function(req, res, next) {
        res.send('404 Not Found');
    });


    app.listen(faucetConfig.httpPort, function() {
        console.log('http server running on port ' + 80);
    });

}

function checkWallet(account) {
    var rs = account;
    //Numeric 64 Bit
    if (!/^[a-zA-Z0-9]+$/.test(account) || account.length < 14 || account.length > 20) {
        // Validation failed
        console.log("Wrong Format");
        errorMessage = 'Input ' + account + ' has wrong format please use Numeric-ID'
    } else {
        checkAccount(account);
    }
}

function checkAccount(account) {
    var Url = faucetConfig.faucetWallet + `/burst?requestType=getAccount&account=${account}`
    request({
            url: Url,
            method: "GET",
            json: true
        },
        function(error, response, body) {
            if (body.errorCode == 5) {
                console.log("2 | Account is checked and ready for transfer");
                checkAccountBalance(account);
            } else {
                console.log("2 | Rejected: Account is already known and has confirmed balance");
                errorMessage = 'Account: ' + account + ' has already a positive balance';
            }

        }
    );
}

function checkAccountBalance(account) {
    var faucetAccount = faucetConfig.faucetAccount;
    var Url = faucetConfig.faucetWallet + `/burst?requestType=getAccount&account=${faucetAccount}`
    request({
            url: Url,
            method: "GET",
            json: true
        },
        function(error, response, body) {
            var balance = satoshiToDecimal(body.balanceNQT);
            console.log("3 | Faucet Account " + faucetConfig.faucetAccount + " | Balance: " + balance);
            //minimum balance for one payout
            if (balance >= 0.2) {
                console.log("4 | Status: adequate balance");
                sendPayment(account);
            } else {
                console.log("3 | Rejected: insufficient balance");
                errorMessage = 'Faucet has insufficient balance';
            }

        }
    );
}

function sendPayment(reci) {
    var key = faucetConfig.passphrase;
    var amount = faucetConfig.claimRewardNQT;
    var fee = faucetConfig.claimRewardNQT;
    fee = decimalToSatoshi(faucetConfig.claimFeeNQT);
    amount = decimalToSatoshi(faucetConfig.claimRewardNQT);

    var Url = faucetConfig.faucetWallet + `/burst?requestType=sendMoney&secretPhrase=${key}&recipient=${reci}&amountNQT=${amount}&feeNQT=${fee}&deadline=1440`
    request({
            url: Url,
            method: "POST",
            json: true
        },
        function(error, response, body) {
            console.log(body)
            if (!error) {
                console.log("5 | " + amount + " Burst transferred to " + reci);
                console.log("|-------------- Claim Successful --------------|");
                errorMessage = 'claim successful'
            }

        }
    );
}

function satoshiToDecimal(sat) {
    if (typeof sat === 'undefined' || isNaN(sat)) {
        return 0.0;
    }
    return parseFloat(sat) / 100000000.0;
}

function decimalToSatoshi(amount) {
    if (typeof amount === 'undefined' || isNaN(amount)) {
        return 0;
    }
    return parseInt(parseFloat(amount) * 100000000);
}