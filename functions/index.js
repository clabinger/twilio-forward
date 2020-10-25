// Firebase Cloud Functions
const functions = require('firebase-functions');

// Firebase Admin SDK
const admin = require('firebase-admin');
admin.initializeApp();

// Firebase Realtime Database
const database = admin.database();

// Do not send the main reply more than once within 10 minutes
const timeThreshold = 10;

// For each forwarding number, load the old number, new number, and the name of the associated person
const targets = require('./targets.json');

// Twilio API
const twilio = require('twilio')(functions.config().twilio.account_sid, functions.config().twilio.auth_token); 

const formatPhone = function (rawPhoneNumber, formatCode) {
	// formatCode: 1 = numbers only, 2 = Twilio, default = human

	let phoneNumber = rawPhoneNumber.replace(/\D+/g, '');
	
	if (phoneNumber.length === 11 && ['0', '1'].includes(phoneNumber[0])) {
		// U.S. phone number with leading 1 or 0. Remove leading digit.
		phoneNumber = phoneNumber.substr(1);
	} else if (phoneNumber.length !== 10) {
		// Any other U.S. phone number should have 10 digits. Not a valid U.S. phone number
		return rawPhoneNumber
	}

	if (formatCode === 2) { // Format for Twilio
		return '+1' + phoneNumber;
	} else if (formatCode === 1) { // Format with numbers only
		return phoneNumber;
	} else { // Format for human
		return '(' + phoneNumber.substr(0, 3) + ') ' + phoneNumber.substr(3, 3) + '-' + phoneNumber.substr(6);
	}	
}

const sendMessage = async function ({ from, to, body, mediaUrls }) {
	// Generic function to send a message. Used for both forwarding and replying

	console.log('Sending message to ' + to + ': "' + body + '". Sending...');

	const parameters = {
		to: formatPhone(to, 2),
		from: formatPhone(from, 2),
		body: body
	};

	if (mediaUrls) {
		parameters.mediaUrl = mediaUrls;
	}

	let message;

	try {
		message = await twilio.messages.create(parameters);
		console.log('Message to ' + to + ' sent successfully.');
		return message;
	} catch (error) {
		console.error('Message to ' + to + ' not sent successfully. Details: ' + error);
		return null;
	}
}

const loadSource = function (source) {
	// Load data about the incoming message from the HTTP request into a source object.

	const result = {
		number: source.From,
		message: source.Body,
		targetNumber: formatPhone(source.To, 1),
		mediaUrls: null
	}

	if (source.NumMedia > 0) {
		result.mediaUrls = [];
		for (let i = 0; i < source.NumMedia; i++) {
			result.mediaUrls.push(source['MediaUrl' + i]);
		}
	}

	return result
}

const loadTarget = function (targetNumber) {
	// Given the target number (the phone number receiving the message), load the data for the target person

	return targets.find(target => target.oldNumber === targetNumber)
}

const forwardToTarget = async function (source, target) {
	// Forward incoming message to new phone number

	return await sendMessage({
		from: target.oldNumber,
		to: target.newNumber, 
		body: 'Fwd from ' + formatPhone(source.number) + ': ' + source.message,
		mediaUrls: source.mediaUrls
	});
}

const eligibleForReply = async function (ref) {
	// Return true if sender is eligible for reply (if we have not replied within the last `timeThreshold` minutes)

	const snapshot = await ref.once('value');
	const currentTime = new Date().getTime();
	const lastReplyTime = snapshot.val();
	const timeSinceLastReply = currentTime - lastReplyTime;
	return (!lastReplyTime || timeSinceLastReply > (timeThreshold * 60 * 1000)); // threshold in minutes, 60 seconds per minute, 1000 milliseconds per second
}

exports.receiveMessage = functions.https.onRequest(async (req, res) => {
	const source = loadSource(req.body);
	const target = loadTarget(source.targetNumber);

	console.log('Receiving message from ' + source.number + ': "' + source.message + '".');

	// Forward message to new number
	const forwardResult = await forwardToTarget(source, target);

	// Store incoming message in database
	const incomingMessageRef = database.ref('/incoming/' + formatPhone(source.number, 1));

	try {
		incomingMessageRef.push({ message: source.message });
		console.log('Incoming message saved to database.');
	} catch (error) {
		console.error('Incoming message NOT saved to database: ' + error);
	}

	// Reply to sender
	const lastReplyTimeRef = database.ref('/replies/' + formatPhone(source.number, 1) + '/time');

	if (source.message.trim().toLowerCase() === 'number') {
		console.log('Sending new phone number to sender.');
		sendMessage({
			from: target.oldNumber,
			to: source.number,
			body: formatPhone(target.newNumber)
		});
	} else if (await eligibleForReply(lastReplyTimeRef)) {
		console.log('Sending main reply to sender.');
		sendMessage({
			from: target.oldNumber,
			to: source.number,
			body: 'I have a new mobile phone number. Please reply NUMBER to get the new number and update your address book. Your original message has' + (forwardResult ? '':' NOT') + ' been forwarded. Thank you. --' + target.name
		});

		// Save reply time to the database for this sender
		try {
			lastReplyTimeRef.set(new Date().getTime())
			console.log('Last reply time for this sender saved to database.');
		} catch (error) {
			console.error('Last reply time for this sender NOT saved to database: ' + error);
		}
	} else {
		console.log('Already replied to ' + source.number + ' within ' + timeThreshold + ' minutes, not replying.');
	}

	// Twilio requires an TwiML response. We are using the Twilio API to send replies instead of responding in the HTTP request, for now.
	res.set('Content-Type', 'text/xml').status(200).send('<Response></Response>');

});
