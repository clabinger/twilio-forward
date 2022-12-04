// Firebase Admin SDK
const admin = require('firebase-admin');

admin.initializeApp();

const forwardToSms = require('./forwardToSms');
const forwardToEmail = require('./forwardToEmail');

exports.forwardToSms = forwardToSms.forwardToSms;
exports.forwardToEmail = forwardToEmail.forwardToEmail;
