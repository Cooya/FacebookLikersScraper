const getFacebookId = require('./getFacebookId');
const MongoClient = require('mongodb').MongoClient;
const sleep = require('system-sleep');

const DATABASE_URL = 'mongodb://nico:coya@localhost:27017/db';
const COLLECTION_NAME = 'facebook.likers';

(async () => {
	const collection = await getDatabaseCollection();
	const profiles = await collection.find().toArray();

	var match;
	for(var profile of profiles) {
		if(!profile.fbId) {
			profile.url = profile.url.replace('?ref=br_rs', '');
			profile.url = profile.url.replace('&ref=br_rs', '');
			match = profile.url.match(/profile\.php\?id=([0-9]+)/);
			if(match)
				profile.fbId = match[1];
			else {
				profile.fbId = await getFacebookId(profile.url);
				sleep(3000);
			}
			console.log(profile);
			await collection.updateOne({_id: profile._id}, profile);
		}
	}
	console.log('Done.');
})();

function getDatabaseCollection() {
	return new Promise((resolve, reject) => {
		MongoClient.connect(DATABASE_URL, (err, db) => {
			if(err)
				reject(err);
			else {
				db.collection(COLLECTION_NAME, (err, coll) => {
					if(err)
						reject(err);
					else
						resolve(coll);
				});
			}
		});
	});
}