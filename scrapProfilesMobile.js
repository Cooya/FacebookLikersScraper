const fs = require('fs');
const MongoClient = require('mongodb').MongoClient;
const puppeteer = require('puppeteer');

let database;

(async () => {
	const config = require('./config.json');
	const args = parseArgs();

	const profilesCollection = await getDatabaseCollection(config.databaseUrl, config.profilesCollectionName);
	console.log('Profiles collection selected.');

	const cursorsCollection = await getDatabaseCollection(config.databaseUrl, config.cursorsCollectionName);
	console.log('Cursors collection selected.');

	if(args.clearCursors) {
		await cursorsCollection.deleteMany();
		console.log('Cursors collection cleared.');
	}

	const cursors = await getCursors(cursorsCollection, config.pageName);
	console.log(cursors.length + ' cursors retrieved from database.');

	const browser = await puppeteer.launch({args: ['--no-sandbox', '--disable-setuid-sandbox'], headless: config.headless});
	console.log('Browser launched.');

	process.on('uncaughtException', async (err) => {
		console.error(err);
		//await browser.close();
		console.log('Browser closed. Exiting process...');
		process.exit(0);
	});
	process.on('unhandledRejection', async (err) => {
		console.error(err);
		//await browser.close();
		console.log('Browser closed. Exiting process...');
		process.exit(0);
	});

	if(args.clearCookies)
		await deleteCookiesFile(config.cookiesFile);

	await logIn(browser, config.cookiesFile, config.fbLogin, config.fbPassword);

	const timer = Date.now();
	let pagesCounter = 0;
	let profilesCounter = 0;
	let newProfilesCounter = 0;
	let profilesInserted;
	let cursor;
	let returnValue;
	if(cursors.length)
		returnValue = {nextPage: cursors[cursors.length - 1].url};
	else
		returnValue = {nextPage: args.targetUrl || 'https://m.facebook.com/search/str/' + config.pageId + '/likers'};
	while(returnValue.nextPage) {
		returnValue = await processSearchPage(browser, config.cookiesFile, returnValue.nextPage);
		if(returnValue.nextPage) {
			profilesInserted = await saveProfileUrlsIntoDatabase(profilesCollection, config.pageName, returnValue.profiles);
			console.log(++pagesCounter + ' search pages processed.');
			console.log((newProfilesCounter += profilesInserted) + ' new profiles inserted into database.');
			console.log((profilesCounter += returnValue.profiles.length) + ' profiles processed, ' + millisecondsToTime(Date.now() - timer) + '.');
			cursor = {page: config.pageName, id: cursors.length, url: returnValue.nextPage};
			await addCursorToDatabase(cursorsCollection, cursor);
			cursors.push(cursor);
		}
	}
	console.log('End of first process.');

	while(cursors.length) {
		cursor = cursors.pop();
		returnValue = await processSearchPage(browser, config.cookiesFile, cursor.url);
		profilesInserted = await saveProfileUrlsIntoDatabase(profilesCollection, config.pageName, returnValue.profiles);
		console.log(++pagesCounter + ' search pages processed.');
		console.log((newProfilesCounter += profilesInserted) + ' new profiles inserted into database.');
		console.log((profilesCounter += returnValue.profiles.length) + ' profiles processed, ' + millisecondsToTime(Date.now() - timer) + '.');
		await removeCursorFromDatabase(cursorsCollection, cursor);
	}
	console.log('End of second process.');
	
	await browser.close();
	console.log('Browser closed. Exiting process...');
	process.exit(0);
})();

async function logIn(browser, cookiesFile, login, password) {
	const page = await browser.newPage();
	//page.on('console', msg => console.log('PAGE LOG:', ...msg.args));
	await loadCookies(cookiesFile, page);
	await page.setUserAgent('Mozilla/5.0 (Windows NT 6.1; Win64; x64; rv:57.0) Gecko/20100101 Firefox/57.0');

	console.log('Going to Facebook...')
	await page.goto('https://www.facebook.com/', {timeout: 60000});
	console.log('Facebook reached.');

	if(!await page.$('#userNav')) {
		console.log('Log in...');
		await page.evaluate((login, password) => {
			document.getElementById('email').value = login;
			document.getElementById('pass').value = password;
			document.querySelector('#loginbutton > input').click();
		}, login, password);
		await page.waitForSelector('#userNav');
		console.log('Logged in.');
		await saveCookies(cookiesFile, page);
	}
	else
		console.log('Already logged in.');

	await page.close();
}

async function processSearchPage(browser, cookiesFile, targetUrl) {
	const page = await browser.newPage();
	//page.on('console', msg => console.log('PAGE LOG:', ...msg.args));
	await loadCookies(cookiesFile, page);
	await page.setUserAgent('Mozilla/5.0 (Windows NT 6.1; Win64; x64; rv:57.0) Gecko/20100101 Firefox/57.0');

	console.log('Going to next search page : ' + targetUrl + '...');
	await page.goto(targetUrl);

	await page.waitForSelector('#objects_container');
	console.log('Page loaded.');
	await page.waitFor(5000);

	const nextPage = await page.evaluate(() => { 
		var nextPageLink = document.querySelector('#see_more_pager > a');
		if(nextPageLink)
			return nextPageLink.href;
		return null;
	});
	if(!nextPage) {
		console.log('End of search detected.');
		return {nextPage: null, profiles: []};
	}
	
	const profiles = await listProfiles(page);

	await page.close();
	return {nextPage: nextPage, profiles: profiles};
}

function getDatabaseCollection(databaseUrl, collectionName) {
	return new Promise((resolve, reject) => {
		MongoClient.connect(databaseUrl, (err, db) => {
			if(err)
				reject(err);
			else {
				database = db;
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

function getCursors(cursorsCollection, pageName) {
	return new Promise((resolve, reject) => {
		cursorsCollection.find({page: pageName}).sort({'id': 1}).toArray((err, result) => {
			if(err)
				reject(err);
			else
				resolve(result);
		});
	});
}

function addCursorToDatabase(cursorsCollection, cursor) {
	return cursorsCollection.insertOne(cursor);
}

function removeCursorFromDatabase(cursorsCollection, cursor) {
	return cursorsCollection.deleteOne({page: cursor.page, id: cursor.id});
}

async function listProfiles(page) {
	console.log('Getting user id list...');
	return await page.evaluate(() => {
		var list = [];
		var tables = document.querySelectorAll('#BrowseResultsContainer table');
		var secondCaseLink;
		var thirdCaseLink;
		var fbId;
		for(var i = 0; i < tables.length; ++i) {
			secondCaseLink = tables[i].querySelector('td:nth-child(2) > a');

			thirdCaseLink = tables[i].querySelector('td:nth-child(3) a');
			fbId = thirdCaseLink.href.match(/thread\/([0-9]+)\/\?/);
			if(!fbId)
				fbId = thirdCaseLink.href.match(/add_friend\.php\?id=([0-9]+)&/);
			list.push({
				name: secondCaseLink.querySelector('div:nth-child(1)').textContent,
				url: secondCaseLink.href.replace('m.facebook.com', 'www.facebook.com').replace(/[\?|&]__xt.*/, ''),
				fbId: fbId[1]
			});
		}
		return list;
	});
	console.log('Done.');
}

function saveProfileUrlsIntoDatabase(collection, page, profiles) {
	return new Promise((resolve, reject) => {
		if(!profiles.length)
			resolve(0);

		let profilesProcessed = 0;
		let profilesInserted = 0;

		profiles.forEach((profile) => {
			profile.page = page;
			collection.updateOne({fbId: profile.fbId, page: page}, profile, {upsert: true})
			.then((result) => {
				if(result.upsertedCount == 0)
					console.log('Profile already into database : ' + profile.url);
				else {
					console.log('Profile added into database successfully : ' + profile.url);
					profilesInserted++;
				}

				if(++profilesProcessed == profiles.length)
					resolve(profilesInserted);
			}, (err) => {
				console.error(err);
				reject(err);
			});
		});
	});
}

function loadCookies(cookiesFile, page) {
	console.log('Loading cookies...');
	return new Promise((resolve, reject) => {
		fs.readFile(cookiesFile, async (err, data) => {
			if(err && err.code != 'ENOENT')
				reject(err);
			else {
				if(!err && data && data != '' && data != '{}')
					await page.setCookie(...JSON.parse(data));
				console.log('Cookies loaded.');
				resolve();
			}
		});
	});
}

function saveCookies(cookiesFile, page) {
	console.log('Saving cookies...');
	return new Promise(async (resolve, reject) => {
		fs.writeFile(cookiesFile, JSON.stringify(await page.cookies()), ((err, data) => {
			if(err)
				reject(err);
			else {
				console.log('Cookies saved.');
				resolve();
			}
		}));
	});
}

function deleteCookiesFile(cookiesFile) {
	return new Promise(async (resolve, reject) => {
		fs.unlink(cookiesFile, ((err) => {
			if(err)
				reject(err);
			else {
				console.log('Cookies file deleted.');
				resolve();
			}
		}));
	});
}

function parseArgs() {
	const args = {};
	process.argv.forEach((arg, index) => {
		if(index == 0 || index == 1) // skip nodejs exe and script filename
			return;

		if(arg == '--clear-cookies')
			args.clearCookies = true;
		else if(arg == '--clear-cursors')
			args.clearCursors = true;
		else
			args.targetUrl = arg;
	});
	return args;
}

function millisecondsToTime(ms) {
	const date = new Date(ms);
	const hours = date.getUTCHours();
	const minutes = date.getUTCMinutes();
	const seconds = date.getUTCSeconds();
	return (hours < 10 ? '0' : '') + hours + ':' + (minutes < 10 ? '0' : '') + minutes + ':' + (seconds < 10 ? '0' : '') + seconds;
}