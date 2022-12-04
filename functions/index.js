// Firebase Admin SDK
const admin = require('firebase-admin');

admin.initializeApp();

const forwardToSms = require('./forwardToSms');

exports.forwardToSms = forwardToSms.forwardToSms;
