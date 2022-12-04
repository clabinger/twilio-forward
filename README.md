# sms-forward

## Purpose

* Forward SMS/MMS messages from an old mobile number to a new mobile number, or to an email address
* Automatically reply to the sender to notify them of the new number

## Deployment Overview

* Deployed using Cloud Functions for Firebase and Firebase Realtime Database
* Messages are received and sent via Twilio (I ported my old phone number to Twilio for this purpose)
* There are 2 separate functions, depending on how you want to forward messages:
  * `forwardToSms` forwards the message to a new mobile number, and also replies to the sender via SMS.
  * `forwardToEmail` forwards the message to an email address, and does not reply to the sender.
* The desired Firebase function endpoint is registered as a webhook on Twilio to handle incoming SMS messages.

## Application Overview

### `forwardToSms`

* For each incoming message to the old phone number, Twilio sends a POST request to the functions endpoint
* The function finds the matching target (including the new phone number) in `targets.json`
* The message is forwarded to the new phone number using the Twilio API
* The function checks the realtime database to see if a reply has been sent to the sender's phone number in the last 10 minutes
* The function sends the main reply message to the sender, but only if a reply has not recently been sent
	* This prevents infinite loops of replies if the sender is an automated system that replies to each message it receives
	* This is also a nicer experience for a human sender if they submit a group of messages all at once (they will only get one reply back)
* If the main reply message was sent, the function stores the current time in the realtime database as the last reply time for the sender's phone number
* If the sender's message is the "NUMBER" keyword, the function sends the new phone number to the sender instead of the main reply message. The database is not checked or written to for these messages.

### `forwardToEmail`

* For each incoming message to the old phone number, Twilio sends a POST request to the functions endpoint
* The function finds the matching target in `targets.json`
* A copy of the message is saved in the Firebase Realtime Database
* The message is forwarded to the target's email address using the Postmark API

## Deployment Steps

### Specify Firebase project

Set your Firebase project ID in `.firebaserc`. You can copy and then edit the sample file:

```sh
cp sample.firebaserc .firebaserc
```

### Specify targets

Multiple targets are supported. Each target forwards from one phone number to another. Specify targets in `targets.json`. You can copy and then edit the sample file:

```sh
cp functions/targets_sample.json functions/targets.json
```

### Set up Twilio authentication

Store your Twilio credentials in Firebase environment variables:

```sh
firebase functions:config:set twilio.account_sid="YOUR ACCOUNT SID" twilio.auth_token="YOUR AUTH TOKEN"
```

### Set up Postmark emails

Store your Postmark credentials in a Firebase secret:

```sh
firebase functions:secrets:set POSTMARK_API_KEY
```
