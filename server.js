// getting required modules
var express = require('express');
var https = require('https');
var expressJwt = require('express-jwt');
var jwt = require('jsonwebtoken');
var pem = require('pem');
var compress = require('compression');
var bodyParser = require('body-parser');
var moment = require('moment');
var request = require('request');
var fs = require('fs');
var CryptoJS = require("crypto-js");
var nodemailer = require('nodemailer');
var SurveyManiaURL = 'http://localhost:1337/';
var SurveyManiasecret = 'secret-df4b8fn5fn6f1vw1cxbuthf4g4n7dty87ng41nsrg35';
var pg = require('pg');
var conString = "postgres://postgres:1234@localhost/SurveyMania";
var mongoose = require('mongoose');
mongoose.connect('mongodb://localhost/SurveyMania');
var mongodb = mongoose.connection;
mongodb.on('error', function () { console.log("Error connecting to mongodb"); });
var MailVerifToken = null, PwdResetToken = null;
mongodb.once('open', function (callback) { 
    console.log("Successfully connecting to mongodb");
    var MailVerifTokenSchema = mongoose.Schema({token: String, userid: Number});
    MailVerifToken = mongoose.model('MailVerifToken', MailVerifTokenSchema);
    var PwdResetTokenSchema = mongoose.Schema({token: String, userid: Number});
    PwdResetToken = mongoose.model('PwdResetToken', PwdResetTokenSchema);
});

var transporter = nodemailer.createTransport({
    service: 'Gmail',
    auth: {
        user: 'surveymania.plic@gmail.com',
        pass: 'surveymania4242'
    }
});

// creating a new app with express framework
var app = express();

app.set('view engine', 'ejs');
app.enable('trust proxy');

// needed to compress all our responses
app.use(compress());
// needed to parse requests body (for example in post requests)
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
// needed to protect / routes with JWT
app.use('/app', expressJwt({secret: SurveyManiasecret}));

app
.get('/home', function (req, res) {
    res.setHeader("Content-Type", "text/html");
    res.render('partials/home');
})

.post('/login', function (req, res) {
    res.setHeader('Content-Type', 'application/json; charset=UTF-8');
    res.setHeader('Accept', 'application/json');
    var email = req.body.email;
    var password = req.body.password;
    //verifying in database that login informations are correct
    pg.connect(conString, function(err, client, done) {
        if(err) res.status(500).json({code: 500, error: "Internal server error", message: "Error fetching client from pool"});
        else {
            var query = 'SELECT surveymania.users.id AS userid, * FROM surveymania.users INNER JOIN surveymania.user_types ON surveymania.users.user_type = user_types.id WHERE surveymania.users.email = \'' + email + '\' AND surveymania.users.password = \'' + password + '\'';
            client.query(query, function(err, result) {
                done();
                if(err) res.status(500).json({code: 500, error: "Internal server error", message: "Error running query"});
                else if (result.rows.length && result.rows[0].verified == true) {
                    console.log(result.rows);
                    var profile = {
                        firstname: result.rows[0].name,
                        lastname: result.rows[0].lastname,
                        email: result.rows[0].email,
                        id: result.rows[0].userid,
                        usertype: result.rows[0].type_name,
                        organization: result.rows[0].user_organization,
                        tokenCreation: new Date().getTime()
                    };
                    // We are sending the profile inside the token
                    var token = jwt.sign(profile, SurveyManiasecret, { expiresInMinutes: 30*24*60 });
                    res.json({token: token});
                }
                else if (result.rows.length) res.json({
                        code: 200, error: "Account not verified",
                        message: "Votre compte n'a pas encore été vérifié. Si vous n'avez pas reçu ou si vous avez perdu votre mail contenant le code de vérification, " +
                                 "vous pouvez en recevoir un nouveau <strong><u><a href='#/accounts/verify/new' class='text-muted'>en cliquant ici.</a></u></strong>"
                    });
                else res.json({code: 200, error: "Unauthorized", message: "No account found with given email and password"});
                client.end();
            });
        }
    });
})

.get('/login', function (req, res) {
    res.setHeader("Content-Type", "text/html");
    res.render('partials/login');
})

.post('/signup', function (req, res) {
    res.setHeader('Content-Type', 'application/json; charset=UTF-8');
    res.setHeader('Accept', 'application/json');
    var inviter = null;
    var error = false;

    pg.connect(conString, function(err, client, done) {
        if(err) res.status(500).json({code: 500, error: "Internal server error", message: "Error fetching client from pool"});
        else {
            var query = 'SELECT * FROM surveymania.users WHERE surveymania.users.email = \'' + req.body.email + '\'';
            client.query(query, function(err, result) {
                done();
                if(err) {
                    res.status(500).json({code: 500, error: "Internal server error", message: "Error running query verifying email"});
                    client.end();
                }
                else if (result.rows.length) {
                    res.status(200).json({code: 200, error: "Conflict", message: "Email already used for an existing account"});
                    client.end();
                }
                else {
                    if (req.body.inviter != null) {
                        var query = 'SELECT * FROM surveymania.users WHERE surveymania.users.email = \'' + req.body.inviter + '\'';
                        client.query(query, function(err, result) {
                            done();
                            if(err) error = true;
                            else if (result.rows.length) inviter = result.rows[0];
                        });
                    }
                    if (error == true) {
                        res.status(500).json({code: 500, error: "Internal server error", message: "Error running query verifying inviter"});
                        client.end();
                    }
                    else {
                        var dateNow = '\'' + moment().format("YYYY-MM-DD hh:mm:ss") + '\'';
                        var email = '\'' + req.body.email + '\'';
                        var password = '\'' + req.body.password + '\'';
                        var firstname = '\'' + req.body.firstname + '\'';
                        var lastname = '\'' + req.body.lastname + '\'';
                        var telephone = (req.body.phone == null) ? 'NULL' : '\'' + req.body.phone + '\'';
                        var adress = (req.body.adress == null) ? 'NULL' : '\'' + req.body.adress + '\'';
                        var postal = (req.body.postal == null) ? 'NULL' : '\'' + req.body.postal + '\'';
                        var town = (req.body.town == null) ? 'NULL' : '\'' + req.body.town + '\'';
                        var country = (req.body.country == null) ? 'NULL' : '\'' + req.body.country + '\'';
                        var inviteDT = (inviter == null) ? 'NULL' : dateNow;
                        var inviterID = (inviter == null) ? 'NULL' : inviter.id;
                        var query = 'INSERT INTO surveymania.users(email, password, user_type, name, lastname, telephone, adress, postal, town, country, creation_dt, last_dt, invite_dt, inviter_id, points, verified) ' +
                            'VALUES (' + email + ', ' + password + ', 1, ' + firstname + ', ' + lastname + ', ' + telephone + ', ' + adress + ', ' + postal + ', ' + town + ', ' + country + ', ' +  dateNow + ', ' + dateNow + ', ' + inviteDT + ', ' + inviterID + ', 50, false) ' +
                            'RETURNING id';
                        client.query(query, function(err, result) {
                            done();
                            if(err) {
                                res.status(500).json({code: 500, error: "Internal server error", message: "Error running query inserting new user"});
                                client.end();
                            }
                            else {
                                var userid = result.rows[0].id;
                                var hash = CryptoJS.HmacMD5(userid + "" + (new Date().getTime()), SurveyManiasecret).toString();
                                var verifyURL = SurveyManiaURL + '#/accounts/verify/' + hash;
                                new MailVerifToken({token: hash, userid: userid}).save(function (err, obj) {
                                    if (err) console.log(err);
                                });
                                var mailOptions = {
                                    from: 'webmaster@surveymania.com',
                                    to: req.body.email,
                                    subject: 'Signin account verification',
                                    html: 'Hello ' + req.body.firstname + ' ' + req.body.lastname + ', welcome to SurveyMania!<br><br>' +
                                          'Please click on the link below to verify your account email and finish your <b>SurveyMania</b> inscription.<br>' +
                                          '<a href="' + verifyURL + '">' + verifyURL + '</a><br><br>' +
                                          'Thank you for your trust and enjoy our services.<br><br>' +
                                          'SurveyMania Team'
                                };
                                transporter.sendMail(mailOptions, function(error, info){
                                    if(error) console.log(error);
                                    else console.log('Message sent: ' + info.response);
                                });
                                if (inviter != null) {
                                    var newpoints = inviter.points + 500;
                                    var query = 'UPDATE surveymania.users SET points=' + newpoints + ' WHERE id=' + inviter.id;
                                    client.query(query, function(err, result) {
                                        done();
                                        if(!err) {
                                            var mailOptions = {
                                                from: 'webmaster@surveymania.com',
                                                to: inviter.email,
                                                subject: 'Someone has just named you as his inviter',
                                                html: req.body.firstname + ' ' + req.body.lastname + ' (' + req.body.email + ') has just named you as his inviter!<br>' +
                                                      'This action made you win 500 points and you have now a total of ' + newpoints + ' points.<br>' +
                                                      'Plus you unlocked a new achievement! You can see the details on your account.<br>' +
                                                      'Congratulations and thank you very much for your activity, we hope you enjoy our services :D<br><br>' +
                                                      'SurveyMania Team'
                                            };
                                            transporter.sendMail(mailOptions, function(error, info){
                                                if(error) console.log(error);
                                                else console.log('Message sent: ' + info.response);
                                            });
                                        }
                                        res.status(200).json({code: 200, message: "Account successfully created"});
                                        client.end();
                                    });
                                }
                                else {
                                    res.status(200).json({code: 200, message: "Account successfully created"});
                                    client.end();
                                }
                            }
                        });
                    }
                }
            });
        }
    });
})

.get('/signup', function (req, res) {
    res.setHeader("Content-Type", "text/html");
    res.render('partials/signup');
})

.get('/app/account', function (req, res) {
    console.log(req.user);
    var achvmnts = '';
    pg.connect(conString, function(err, client, done) {
        if (err) console.log(err);
        var query = 'SELECT * FROM surveymania.user_achievements INNER JOIN surveymania.achievements ON surveymania.user_achievements.achiev_id = surveymania.achievements.id WHERE surveymania.user_achievements.user_id=3';
        client.query(query, function(err, result) {
            if (err) console.log(err);
            done();
            if (result.rows.length) {
                achvmnts = result.rows; 
            }
            client.end();
            res.setHeader("Content-Type", "text/html");
            res.render('partials/account', {user: req.user, achievements: achvmnts});
        });
    });
})

.get('/accounts/verify/:token', function (req, res) {
    res.setHeader("Content-Type", "text/html");
    var token = req.params.token;
    if (token != "new") {
        MailVerifToken.find({token: token}, function (err, tokens) {
            if (err || !tokens.length) {
                if (err) console.error(err);
                token = undefined;
            }
            res.render('partials/mail-verify', {token: token});
        });
    }
    else res.render('partials/mail-verify', {token: token});
})

.post('/accounts/verify/:token', function (req, res) {
    res.setHeader('Content-Type', 'application/json; charset=UTF-8');
    res.setHeader('Accept', 'application/json');
    var token = req.params.token;
    var password = req.body.password;
    var userid = null;
    MailVerifToken.find({token: token}, function (err, tokens) {
        if (err) {
            console.error(err);
            res.status(500).json({code: 500, error: "Internal server error", message: "Une erreur est survenue lors de la recherche du token de vérification d'email"});
        }
        else if (!tokens.length) {
            res.json({code: 200, error: "Invalid verification code", message: "Le code de vérification est invalide, votre compte n'a pas pu être vérifié"});
        }
        else {
            userid = tokens[0].userid;
            pg.connect(conString, function(err, client, done) {
                if(err) res.status(500).json({code: 500, error: "Internal server error", message: "Error fetching client from pool"});
                else {
                    var query = 'SELECT surveymania.users.id AS userid, * FROM surveymania.users WHERE surveymania.users.id = ' + userid + ' AND surveymania.users.password = \'' + password + '\'';
                    client.query(query, function(err, result) {
                        done();
                        if(err) {
                            client.end();
                            res.status(500).json({code: 500, error: "Internal server error", message: "Error running query"});
                        }
                        else if (result.rows.length && result.rows[0].verified == false) {
                            var dateNow = '\'' + moment().format("YYYY-MM-DD hh:mm:ss") + '\'';
                            var query = 'UPDATE surveymania.users SET verified=true, verified_dt=' + dateNow + ' WHERE id=' + userid;
                            client.query(query, function(err, result) {
                                done();
                                if(err) res.status(500).json({code: 500, error: "Internal server error", message: "Error running query"});
                                else {
                                    MailVerifToken.find({userid: userid}).remove(function (err) {
                                        if (err) console.log(err);
                                        res.json({code: 200, message: "Le compte a bien été vérifié"});
                                    });
                                }
                                client.end();
                            });
                        }
                        else if (result.rows.length) {
                            client.end();
                            res.json({code: 200, error: "Already verified", message: "Votre compte a déjà été vérifié, vous pouvez donc y accéder en vous connectant"});
                        }
                        else {
                            client.end();
                            res.json({code: 200, error: "Unauthorized", message: "Votre mot de passe ne correspond pas au compte associé à ce token, il n'a donc pas pu être vérifié"});
                        }
                    });
                }
            });
        }
    });
})

.post('/accounts/get/verify', function (req, res) {
    res.setHeader('Content-Type', 'application/json; charset=UTF-8');
    res.setHeader('Accept', 'application/json');
    var email = req.body.email;
    var userid = null;
    pg.connect(conString, function(err, client, done) {
        if(err) res.status(500).json({code: 500, error: "Internal server error", message: "Error fetching client from pool"});
        else {
            var query = 'SELECT surveymania.users.id AS userid, * FROM surveymania.users WHERE surveymania.users.email = \'' + email + '\'';
            client.query(query, function(err, result) {
                done();
                if(err) res.status(500).json({code: 500, error: "Internal server error", message: "Error running query"});
                else if (result.rows.length && result.rows[0].verified == false) {
                    var userid = result.rows[0].userid;
                    var firstname = result.rows[0].name;
                    var lastname = result.rows[0].lastname;
                    var hash = CryptoJS.HmacMD5(userid + "" + (new Date().getTime()), SurveyManiasecret).toString();
                    var verifyURL = SurveyManiaURL + '#/accounts/verify/' + hash;
                    new MailVerifToken({token: hash, userid: userid}).save(function (err, obj) {
                        if (err) console.log(err);
                    });
                    var mailOptions = {
                        from: 'webmaster@surveymania.com',
                        to: email,
                        subject: 'New account verification code',
                        html: 'Hello ' + firstname + ' ' + lastname + ', welcome to SurveyMania!<br><br>' +
                              'Please click on the new link below to verify your account email and finish your <b>SurveyMania</b> inscription.<br>' +
                              '<a href="' + verifyURL + '">' + verifyURL + '</a><br><br>' +
                              'Thank you for your trust and enjoy our services.<br><br>' +
                              'SurveyMania Team'
                    };
                    transporter.sendMail(mailOptions, function(error, info){
                        if(error) {
                            console.log(error);
                            res.status(500).json({code: 500, error: "Internal server error", message: "Une erreur est survenue lors de l'envoie du mail avec votre nouveau code de vérification"});
                        }
                        else {
                            console.log('Message sent: ' + info.response);
                            res.json({code:200, message: "Le mail contenant votre nouveau code de vérification a bien été envoyé. Veuillez suivre ses instructions afin de finaliser votre inscription"});
                        }
                    });
                }
                else if (result.rows.length) {
                    res.json({code: 200, error: "Already verified", message: "Votre compte a déjà été vérifié, vous pouvez donc y accéder en vous connectant"});
                }
                else res.json({code: 200, error: "Unauthorized", message: "Aucun compte associé à cet email n'a été trouvé"});
                client.end();
            });
        }
    });
})

.get('/accounts/reset/:token', function (req, res) {
    res.setHeader("Content-Type", "text/html");
    var token = req.params.token;
    if (token != "new") {
        PwdResetToken.find({token: token}, function (err, tokens) {
            if (err || !tokens.length) {
                if (err) console.error(err);
                token = undefined;
            }
            res.render('partials/pwd-reset', {token: token});
        });
    }
    else res.render('partials/pwd-reset', {token: token});
})

.post('/accounts/reset/:token', function (req, res) {
    res.setHeader('Content-Type', 'application/json; charset=UTF-8');
    res.setHeader('Accept', 'application/json');
    var token = req.params.token;
    var email = req.body.email;
    var password = '\'' + req.body.password + '\'';
    var userid = null;
    PwdResetToken.find({token: token}, function (err, tokens) {
        if (err) {
            console.error(err);
            res.status(500).json({code: 500, error: "Internal server error", message: "Une erreur est survenue lors de la recherche du token de vérification d'email"});
        }
        else if (!tokens.length) {
            res.json({code: 200, error: "Invalid reinitialization code", message: "Le code de réinitialisation de mot de passe est invalide, le mot de passe n'a pas pu être modifié"});
        }
        else {
            userid = tokens[0].userid;
            pg.connect(conString, function(err, client, done) {
                if(err) res.status(500).json({code: 500, error: "Internal server error", message: "Error fetching client from pool"});
                else {
                    var query = 'SELECT surveymania.users.id AS userid, * FROM surveymania.users WHERE surveymania.users.id = ' + userid + ' AND surveymania.users.email = \'' + email + '\'';
                    client.query(query, function(err, result) {
                        done();
                        if(err) {
                            client.end();
                            res.status(500).json({code: 500, error: "Internal server error", message: "Error running query"});
                        }
                        else if (result.rows.length) {
                            var query = 'UPDATE surveymania.users SET password=' + password + ' WHERE id=' + userid;
                            client.query(query, function(err, result) {
                                done();
                                if(err) res.status(500).json({code: 500, error: "Internal server error", message: "Error running query"});
                                else {
                                    PwdResetToken.find({userid: userid}).remove(function (err) {
                                        if (err) console.log(err);
                                        res.json({code: 200, message: "Le mot de passe a bien été modifié"});
                                    });
                                }
                                client.end();
                            });
                        }
                        else {
                            client.end();
                            res.json({code: 200, error: "Unauthorized", message: "Votre email ne correspond pas au compte associé à ce token, le mot de passe n'a pas pu être modifié"});
                        }
                    });
                }
            });
        }
    });
})

.post('/accounts/get/reset', function (req, res) {
    res.setHeader('Content-Type', 'application/json; charset=UTF-8');
    res.setHeader('Accept', 'application/json');
    var email = req.body.email;
    var userid = null;
    pg.connect(conString, function(err, client, done) {
        if(err) res.status(500).json({code: 500, error: "Internal server error", message: "Error fetching client from pool"});
        else {
            var query = 'SELECT surveymania.users.id AS userid, * FROM surveymania.users WHERE surveymania.users.email = \'' + email + '\'';
            client.query(query, function(err, result) {
                done();
                if(err) res.status(500).json({code: 500, error: "Internal server error", message: "Error running query"});
                else if (result.rows.length) {
                    var userid = result.rows[0].userid;
                    var firstname = result.rows[0].name;
                    var lastname = result.rows[0].lastname;
                    var hash = CryptoJS.HmacMD5(userid + "" + (new Date().getTime()), SurveyManiasecret).toString();
                    var verifyURL = SurveyManiaURL + '#/accounts/reset/' + hash;
                    new PwdResetToken({token: hash, userid: userid}).save(function (err, obj) {
                        if (err) console.log(err);
                    });
                    var mailOptions = {
                        from: 'webmaster@surveymania.com',
                        to: email,
                        subject: 'Password reinitialization code',
                        html: 'Hello ' + firstname + ' ' + lastname + ' !<br><br>' +
                              'A request to reinitialize your password has been made on your behalf.<br>' +
                              'If you are not at the origin of this action, just ignore this email and your password won\'t be changed.<br>' +
                              'If you want to reinitialize your password please click on the link below.<br>' +
                              '<a href="' + verifyURL + '">' + verifyURL + '</a><br><br>' +
                              'Thank you for your trust and enjoy our services.<br><br>' +
                              'SurveyMania Team'
                    };
                    transporter.sendMail(mailOptions, function(error, info){
                        if(error) {
                            console.log(error);
                            res.status(500).json({code: 500, error: "Internal server error", message: "Une erreur est survenue lors de l'envoie du mail avec votre nouveau code de réinitialisation"});
                        }
                        else {
                            console.log('Message sent: ' + info.response);
                            res.json({code:200, message: "Le mail contenant votre nouveau code de réinitialisation de mot de passe a bien été envoyé."});
                        }
                    });
                }
                else res.json({code: 200, error: "Unauthorized", message: "Aucun compte associé à cet email n'a été trouvé"});
                client.end();
            });
        }
    });
})

.get('/401-unauthorized', function (req, res) {
    res.setHeader("Content-Type", "text/html");
    res.render('401-unauthorized');
})

.get('/404-notfound', function (req, res) {
    res.setHeader("Content-Type", "text/html");
    res.render('404-notfound');
})

// route to get index page
.get('/', function (req, res) {
    res.setHeader("Content-Type", "text/html");
    res.render('index');
})

// route to get static files
.use(express.static(__dirname + '/app'))

// redirecting to index for any other route
.use(function (req, res) {
    res.setHeader("Content-Type", "text/html");
    res.status(404).render('404-notfound');
});

/* setting ssl certificate to create https server
pem.createCertificate({days:365, selfSigned:true}, function (err, keys) {
    https.createServer({key: keys.serviceKey, cert: keys.certificate}, app).listen(4300, 'localhost');
    pem.getPublicKey(keys.certificate, function (err, key) {
        console.log(keys.serviceKey);
        console.log(keys.certificate);
        console.log(key);
    });
    console.log('HTTPS Server running at https://localhost:4300/');
});*/

app.listen(1337, 'localhost');

console.log('HTTP Server running at http://localhost:1337/');
