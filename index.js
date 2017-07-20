"use strict";
var builder = require("botbuilder");
var botbuilder_azure = require("botbuilder-azure");
var path = require('path');
var bodyParser = require('body-parser');
const crypto = require('crypto');
const passport = require ('passport-restify');
const OIDCStrategy = require ('passport-azure-ad').OIDCStrategy;
const expressSession = require('express-session');
//const https = requrie('https');

var useEmulator = (process.env.NODE_ENV == 'development');
useEmulator = true;

var connector = useEmulator ? new builder.ChatConnector() : new botbuilder_azure.BotServiceConnector({
    appId: process.env['MicrosoftAppId'],
    appPassword: process.env['MicrosoftAppPassword'],
    stateEndpoint: process.env['BotStateEndpoint'],
    openIdMetadata: process.env['BotOpenIdMetadata']
});

var bot = new builder.UniversalBot(connector);
bot.localePath(path.join(__dirname, './locale'));

//set up restify server

var restify = require('restify');
    var server = restify.createServer();
    server.listen(3978, function() {
        console.log('test bot endpont at http://localhost:3978/api/messages');
    });
    server.post('/api/messages', connector.listen());    

//Auth setup
server.use(restify.bodyParser());
server.use(restify.queryParser());
server.use(expressSession({ secret:'keyboard cat'} ));
server.use(passport.initialize());

server.get('/',
     function(req,res){
     res.send('hello,user!');
})

server.get('/fail',
     function(req,res){
         res.send('login fail');
     })

server.get('/login', function(req, res, next){
     passport.authenticate('azuread-openidconnect',
     {
          response : res,
          failureRedirect:'/fail',
          customState: 'my_state'

     },function(err, user, info){
         console.log('login');
         if (err) {
             console.log(err);
         }
         if (user) {
             return res.send("welcome!");
         }
     }) (req, res, next)
})

server.post('/api/auth', passport.authenticate('azuread-openidconnect'));

server.get('/api/auth',
     passport.authenticate('azuread-openidconnect',{failureRedirect:'/fail'}),
     function(req,res){
         console.log('OAuthCallBack');
         const address = JSON.parse(req.query.state);
         const magicCode = crypto.randomBytes(4).toString('hex');
         const messageData = {magicCode:magicCode, accessToken: req.user.accessToken, refreshToken: req.user.refreshToken, name:req.user.displayName,  email: req.user.preferred_username};
         
         var continueMsg = new builder.Message().address(address).text(JSON.stringify(messageData));
         console.log(continueMsg.toMessage());

         bot.receive(continueMsg.toMessage());
         res.send('Welcome'+req.user.displayName +'! Please copy this number and paste it back to your chat so your authentication can complete: '+ magicCode);
     }
)

passport.use(new OIDCStrategy({
    redirectUrl:'http://localhost:3978/api/auth',
    allowHttpForRedirectUrl:true,
    clientID:'5fe844d7-e4d1-4c4c-ba70-078297b00abc',
    clientSecret:'?aTvTEbwcNfUF2,^',
    identityMetadata: 'https://login.microsoftonline.com/nuffieldbot.onmicrosoft.com/v2.0/.well-known/openid-configuration', 
    skipUserProfile: true,
    responseType: 'code id_token',
    responseMode: 'form_post',
    isB2C:true,
    scope:['email','profile','offline_access','https://outlook.office.com/mail/read'],
    loggingLevel:'info',
    tenantName:'nuffieldbot',
    passReqToCallback:true
},function(req, iss, sub, profile, accessToken, refreshToken, done){
   log.info('Example:Email address we received was:', profile.email);
   process.nextTick(function(){
       findByEmail(profile.email,function(err,user){
           if (err) {
               return done(err);
           }
           if (!user){
               users.push(profile);
               return done(null, profile);
           }
           return done(null, user);
       })
   })
  }

));
  //passport session set up
  passport.serializeUser(function(user,done){
      done(null, user.email);
  })
 
  passport.deserializeUser(function(id,done){
      findByEmail(id, function(err,user){
          done (err, user);
      })
  })
  var users= [];
  var findByEmail = function(email, fn) {
  for (var i = 0, len = users.length; i < len; i++) {
    var user = users[i];
    log.info('we are using user: ', user);
    if (user.email === email) {
      return fn(null, user);
    }
  }
  return fn(null, null);
};


//bot dialogs
  //default dialog
bot.dialog('/',[
    function(session,args,next){
       if(!(session.userData.userName && session.userData.accessToken && session.userData.refreshToken)){
           session.send('Welcome! This bot use Microsoft active directory B2C to authorize user');
           session.beginDialog('signinPrompt');
       } else
       {
           next();
       }
    },
    function(session, results, next){
               if(!(session.userData.userName && session.userData.accessToken && session.userData.refreshToken)){
                   session.send("i love"+session.userData.userName);
               }
               else {
                   session.replaceDialog('/')
               }
    }
])


function login(session) {    
   const link = 'http://localhost:3978/login?p=B2C_1_signin';

    var msg = new builder.Message(session);
    msg.attachments([
        new builder.SigninCard(session)
        .text('please sign before you go to next step')
        .button("signin",link)
    ])
    session.send('nihao');
    session.send(msg);
}

bot.dialog('signinPrompt',[
    function(session) {
        login(session);
    },
    function(session,results) {
        session.userData.loginData = JSON.parse(result.response);
        if (session.userData.loginData && session.userData.loginData.magicCode && session.userData.loginData.accessToken){
            session.beginDialog('validateCode');
        } else{
            session.replaceDialog('signinPrompt',{invalid:true});
        }
    },
    function(session,results){
        if (results.response){
            session.useData.userNmae = session.userData.loginData.name;
            session.endDialogWithResult({response: true});
        } else {
            session.endDialogWithResult({response: false})
        }
    }
])

bot.dialog('validateCode',[
    function(session){
        builder.Prompts.text(session,"Please enter the code you received or type 'quit' to end.");
    },
    function (session, results){
        const reply =results.response;
        if (reply =='quit') {
            session.endDialogWithResult({response: false})
        } else {
            if (reply == session.userData.loginData.magicCode){
                session.userData.accessToken = session.userData.loginData.accessToken;
                session.userData.refreshToken = session.userData.loginData.refreshToken;

                session.endDialogWithResult({response: true});

            }  else {
                session.send ('this is a invalid code.Please try again');
                session.replaceDialog('validateCode');
            }
        }
    }
])