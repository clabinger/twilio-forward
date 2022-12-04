// Firebase Cloud Functions
const functions = require('firebase-functions');

// Firebase Admin SDK
const admin = require('firebase-admin');

// Firebase Realtime Database
const database = admin.database();

// Postmark to send emails
const postmark = require('postmark');

// Postmark client is reinitialized on every function invocation
// but is scoped here to be accessed by sendEmail()
let postmarkClient;

// Got HTTP request library to download media attachments from Twilio URLs
const got = require('got');

// Mime-Types package to map content-type headers to extensions
const mime = require('mime-types');

// For each forwarding number, load the number, forwarding email, and name of the associated person
const targets = require('./targets.json');

const formatPhone = (rawPhoneNumber, numbersOnly) => {
  let phoneNumber = rawPhoneNumber.replace(/\D+/g, '');

  if (phoneNumber.length === 11 && ['0', '1'].includes(phoneNumber[0])) {
    // U.S. phone number with leading 1 or 0. Remove leading digit.
    phoneNumber = phoneNumber.substr(1);
  } else if (phoneNumber.length !== 10) {
    // Any other U.S. phone number should have 10 digits. Not a valid U.S. phone number
    return rawPhoneNumber;
  }

  if (numbersOnly) { // Format with numbers only
    return phoneNumber;
  } else { // Format for human
    return `(${phoneNumber.substr(0, 3)}) ${phoneNumber.substr(3, 3)}-${phoneNumber.substr(6)}`;
  }
};

const urlToAttachment = async (url) => {
  const response = got(url, {
    encoding: 'base64',
  });

  const body = await response.text();
  const { headers } = await response;

  const extension = mime.extension(headers['content-type']);

  return {
    Name: extension ? `media.${extension}` : 'media',
    ContentType: headers['content-type'],
    Content: body,
  };
};

const sendEmail = async ({
  from, to, subject, body, attachments,
}) => {
  try {
    const message = await postmarkClient.sendEmail({
      From: from,
      To: to,
      Subject: subject,
      TextBody: body,
      Attachments: attachments,
    });

    console.log(`Email to ${to} sent successfully.`);
    return message;
  } catch (error) {
    console.error(`Error sending email to ${to}. ${error}`);
    return null;
  }
};

const loadSource = (source) => {
  // Load data about the incoming message from the HTTP request into a source object.

  const result = {
    number: source.From,
    message: source.Body,
    targetNumber: formatPhone(source.To, 1),
    mediaUrls: null,
  };

  if (source.NumMedia > 0) {
    result.mediaUrls = [];
    for (let i = 0; i < source.NumMedia; i++) {
      result.mediaUrls.push(source[`MediaUrl${i}`]);
    }
  }

  return result;
};

// Given the target number (the phone number receiving the message),
// load the data for the target person
const loadTarget = (targetNumber) => targets.find((target) => target.number === targetNumber);

// Forward incoming message to target email
const forwardToTarget = async (source, target) => {
  const mediaErrorUrls = [];
  let attachments = null;

  if (source.mediaUrls) {
    attachments = [];
    await Promise.all(source.mediaUrls.map(async (url) => {
      try {
        const attachment = await urlToAttachment(url);
        attachments.push(attachment);
      } catch (error) {
        console.error(`Error downloading media. ${error} - url ${url}`);
        mediaErrorUrls.push(url);
      }
    }));
  }

  let message = `Your old phone number ${formatPhone(target.number)} has received a message from ${formatPhone(source.number)}:\n\n${source.message}`;

  if (mediaErrorUrls.length > 0) {
    message += `\n\nThere was an error including ${mediaErrorUrls.length} ${mediaErrorUrls.length === 1 ? 'attachment' : 'attachments'}:\n${mediaErrorUrls.join('\n')}`;
  }

  return sendEmail({
    from: target.fromEmail,
    to: target.email,
    subject: `Text message from ${formatPhone(source.number)}`,
    body: message,
    attachments,
  });
};

exports.forwardToEmail = functions.runWith({ secrets: ['POSTMARK_API_KEY'] }).https.onRequest(async (req, res) => {
  // Reinitialize on each function invocation to ensure current API key is used
  postmarkClient = new postmark.ServerClient(process.env.POSTMARK_API_KEY);

  const source = loadSource(req.body);
  const target = loadTarget(source.targetNumber);

  console.log(`Receiving message from ${source.number} and forwarding to ${target.email}: "${source.message}".`);

  // Forward message to email
  await forwardToTarget(source, target);

  // Store incoming message in database
  const incomingMessageRef = database.ref(`/incoming/${formatPhone(target.number, 1)}/${formatPhone(source.number, 1)}`);

  try {
    incomingMessageRef.push({
      message: source.message,
      from: source.number,
      to: source.targetNumber,
      time: (new Date().getTime()),
    });
    console.log('Incoming message saved to database.');
  } catch (error) {
    console.error(`Error saving incoming message to database: ${error}`);
  }

  // Twilio requires an TwiML response
  res.set('Content-Type', 'text/xml').status(200).send('<Response></Response>');
});
