const fs = require('fs');
const json2csv = require('json2csv');
const MongoClient = require('mongodb').MongoClient;

(async () => {
	const config = require('./config.json');

	const collection = await getDatabaseCollection(config.databaseUrl, config.profilesCollectionName);
	console.log('Collection "' + config.profilesCollectionName + '" selected.');

	const profiles = await collection.find({page: config.pageName}).toArray();
	console.log('Profiles from page = "' + config.pageName + '" retrieved.');

	try {
		const result = json2csv({data: profiles, fields: config.csvFields});
		fs.writeFile(config.pageName + '.csv', result, (err) => {
			if(err)
				console.error(err);
			else
				console.log('CSV file "' + config.pageName + '.csv" generated successfully.');
			process.exit(0);
		});
	} catch(err) {
		console.error(err);
	}
})();

function getDatabaseCollection(databaseUrl, collectionName) {
	return new Promise((resolve, reject) => {
		MongoClient.connect(databaseUrl, (err, db) => {
			if(err)
				reject(err);
			else {
				db.collection(collectionName, (err, coll) => {
					if(err)
						reject(err);
					else
						resolve(coll);
				});
			}
		});
	});
}