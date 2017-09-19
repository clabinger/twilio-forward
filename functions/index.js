
// The Cloud Functions for Firebase SDK to create Cloud Functions and setup triggers.
const functions = require('firebase-functions');

// The Firebase Admin SDK to access the Firebase Realtime Database. 
const admin = require('firebase-admin');

admin.initializeApp(functions.config().firebase);

const formatPhone = function(phone, twilio_format){

	let number = phone.replace(/\D+/g, '');

	// Return $phone (unchanged) if not a valid U.S. phone number
	if(number.length<10 || number.length>11){ // If not 10 or 11 digits, can't be U.S. phone number
		return phone;
	}else if(number.charAt(0)==='0' || number.charAt(0)==='1'){
		number = number.substr(1);
	}

	if(number.length!==10){ // Should be 10 digits at this point, otherwise it's not a valid U.S. phone number
		return phone;
	}

	if(twilio_format){
		return '+1'+number;
	}else{
		return '('+number.substr(0, 3)+') '+number.substr(3, 3)+'-'+number.substr(6);
	}	

}

const sendMessage = function(from, to, body, mediaUrls, callback){

	const client = require('twilio')(functions.config().twilio.account_sid, functions.config().twilio.auth_token); 

	let parameters = { 
	    to: formatPhone(to, true),
	    from: formatPhone(from, true),
	    body: body
	}

	if(mediaUrls){
		parameters.mediaUrl = mediaUrls;
	}

	client.messages.create(parameters, function(err, message){
	    
	    if(err!==null){
	    	console.error(err);
	    	console.info(message.sid);
	    }

	    if(typeof callback === 'function'){
	    	callback((err===null));
	    }
	});

}

const receiveMessage = function(options){

	return functions.https.onRequest((req, res) => {

	    const forward_message = 'Verizon Fwd from '+formatPhone(req.body['From'])+': '+req.body['Body'];

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

		        incoming_message_test = req.body['Body'].trim().toLowerCase();
		        
		        let reply_message = '';

		        if(incoming_message_test==='number'){
		            reply_message = formatPhone(options.new_number);
		        }else{
		        	reply_message = 'I have a new mobile phone number. Please reply NUMBER to get the new number and update your address book. Your original message has'+(successful ? '':' NOT')+' been forwarded. Thank you. --'+options.name;
		        }

		        sendMessage(
		        	options.old_number,
		        	req.body['From'], 
		        	reply_message
			    );
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
