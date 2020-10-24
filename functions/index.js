// The Cloud Functions for Firebase SDK to create Cloud Functions and setup triggers.
const functions = require('firebase-functions');

// The Firebase Admin SDK to access the Firebase Realtime Database. 
const admin = require('firebase-admin');
admin.initializeApp();

const database = admin.database();

const time_threshold = 10; // Do not reply more than once within 10 minutes

const targets = require('./targets.json');

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
	console.log('Sending message to ' + to + ': "' + body + '". Sending...');

	const client = require('twilio')(functions.config().twilio.account_sid, functions.config().twilio.auth_token); 

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
		message = await client.messages.create(parameters);
		console.log('Message to ' + to + ' sent successfully.');
		return message;
	} catch (error) {
		console.error('Message to ' + to + ' not sent successfully. Details: ' + error);
		return null;
	}
}

const loadSource = function (source) {
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
	return await sendMessage({
		from: target.oldNumber,
		to: target.newNumber, 
		body: 'Fwd from ' + formatPhone(source.number) + ': ' + source.message,
		mediaUrls: source.mediaUrls
	});
}

exports.receiveMessage = functions.https.onRequest(async (req, res) => {
	const source = loadSource(req.body);
	const target = loadTarget(source.targetNumber);

	console.log('Receiving message from ' + source.number + ': "' + source.message + '".');

	// Forward message to new number
	const forwardResult = await forwardToTarget(source, target);

	console.log('Replying to sender...');

	const thisTime = new Date().getTime();

	// Only reply if they have not gotten a reply in the last x minutes

	var numberRef = database.ref('/replies/' + formatPhone(source.number, 1) + '/time');
	var messageRef = database.ref('/incoming/' + formatPhone(source.number, 1));

	const snapshot = await numberRef.once('value')

	const lastTime = snapshot.val();
	const incoming_message_test = source.message.trim().toLowerCase();
	const requested_number = (incoming_message_test === 'number');
	const time_since = thisTime - lastTime;

	try {
		messageRef.push({ message: source.message });
		console.log('Incoming message saved to database.');
	} catch (error) {
		console.error('Incoming message NOT saved to database: ' + error);
	}
	

	if (requested_number || !lastTime || time_since > (time_threshold * 60 * 1000)) { // x minutes, 60 seconds per minute, 1000 millseconds per second
		let reply_message = '';

		if (requested_number) {
			reply_message = formatPhone(target.newNumber);
		} else {
			reply_message = 'I have a new mobile phone number. Please reply NUMBER to get the new number and update your address book. Your original message has' + (forwardResult ? '':' NOT') + ' been forwarded. Thank you. --' + target.name;
		}

		sendMessage({
			from: target.oldNumber,
			to: source.number,
			body: reply_message
		});

		// Save reply time to the database for this sender
		try {
			numberRef.set(thisTime)
			console.log('Last reply time for this sender saved to database.');
		} catch (error) {
			console.error('Last reply time for this sender NOT saved to database: ' + error);
		}
	} else {
		console.log('Already replied to ' + source.number + ' within ' + time_threshold + ' minutes, not replying.');
	}

	res.set('Content-Type', 'text/xml').status(200).send('<Response></Response>');

});
