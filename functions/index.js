// The Cloud Functions for Firebase SDK to create Cloud Functions and setup triggers.
const functions = require('firebase-functions');

// The Firebase Admin SDK to access the Firebase Realtime Database. 
const admin = require('firebase-admin');
admin.initializeApp();

const firestore = admin.firestore();

const time_threshold = 1; // Do not reply more than once within 5 minutes

const formatPhone = function(rawPhoneNumber, formatCode) {
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

const sendMessage = function(from, to, body, mediaUrls, callback){

	console.log('Sending message to '+to+': "'+body+'". Sending...');

	const client = require('twilio')(functions.config().twilio.account_sid, functions.config().twilio.auth_token); 

	let parameters = { 
	    to: formatPhone(to, 2),
	    from: formatPhone(from, 2),
	    body: body
	}

	if(mediaUrls){
		parameters.mediaUrl = mediaUrls;
	}

	client.messages.create(parameters, function(err, message){
	    
	    if(err!==null){
	    	console.error('Message to '+to+' not sent successfully: '+err);
	    	console.info(message.sid);
	    }else{
	    	console.log('Message to '+to+' sent successfully.');
	    }

	    if(typeof callback === 'function'){
	    	callback((err===null));
	    }
	});

}

const receiveMessage = function(options){

	return functions.https.onRequest((req, res) => {

		const third_party_number = req.body['From'];
		const third_party_message = req.body['Body'];

		console.log('Receiving message from '+third_party_number+': "'+third_party_message+'".');

	    const forward_message = 'Verizon Fwd from '+formatPhone(third_party_number)+': '+third_party_message;

	    // Forward message to new number

	    let mediaUrls = null;

		if(req.body['NumMedia']>0){
			mediaUrls = [];
			for(let i=0; i<req.body['NumMedia']; i++){
				mediaUrls.push(req.body['MediaUrl'+i]);
			}
		}

		const result = sendMessage(
			options.old_number,
			options.new_number, 
			forward_message, 
			mediaUrls,
			function(successful){ // Reply to third party

				console.log('Replying to 3rd party...');

				const thisTime = new Date().getTime();

				// Only reply if they have not gotten a reply in the last x minutes

				var numberRef = admin.database().ref('/replies/'+formatPhone(third_party_number, 1)+'/time');
				var messageRef = admin.database().ref('/incoming/'+formatPhone(third_party_number, 1));

				numberRef.once('value').then(function(snapshot){
					const lastTime = snapshot.val();

			        const incoming_message_test = third_party_message.trim().toLowerCase();

			        const requested_number = (incoming_message_test==='number');

			        const time_since = thisTime - lastTime;

				    messageRef.push({message: third_party_message});

					if(requested_number || !lastTime || time_since > (time_threshold * 60 * 1000)){ // x minutes, 60 seconds per minute, 1000 millseconds per second
				        
				        let reply_message = '';

				        if(requested_number){
				            reply_message = formatPhone(options.new_number);
				        }else{
				        	reply_message = 'I have a new mobile phone number. Please reply NUMBER to get the new number and update your address book. Your original message has'+(successful ? '':' NOT')+' been forwarded. Thank you. --'+options.name;
				        }

				        sendMessage(
				        	options.old_number,
				        	third_party_number,
				        	reply_message
					    );

					    // Save in db that we sent message to this person
					    numberRef.set(thisTime, function(error){
					    	if(error){
					    		console.error('Sent message was NOT saved to the database: '+error);
					    	}else{
					    		console.log('Sent message saved to database.');
					    	}
					    });
					}else{
						console.log('Already replied to '+third_party_number+' within '+time_threshold+' minutes, not replying.');
					}

				});
			}
		);

		res.set('Content-Type', 'text/xml').status(200).send('<Response></Response>');

	});
};

// Build out exported functions for each instance
for(let i in functions.config().instances){
	let options = functions.config().instances[i];
	exports['receiveMessage_'+i] = receiveMessage(options);
}


exports.addMessage = functions.https.onRequest((req, res) => {

  const message = req.query['Body'];
  // Push the new message into the Realtime Database using the Firebase Admin SDK.
  admin.database().ref('/incoming').push({message: message}).then(snapshot => {
    // Redirect with 303 SEE OTHER to the URL of the pushed object in the Firebase console.
    res.redirect(303, snapshot.ref);
  });
});
