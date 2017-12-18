const fs = require('fs');
const MongoClient = require('mongodb').MongoClient;
const puppeteer = require('puppeteer');

(async () => {
	const config = require('./config.json');

	const collection = await getDatabaseCollection(config.databaseUrl, config.collectionName);
	console.log('Collection selected.');

	const browser = await puppeteer.launch({args: ['--no-sandbox', '--disable-setuid-sandbox'], headless: true});
	console.log('Browser launched.');

	await logIn(browser, config.cookiesFile);

	const timer = Date.now();
	let pageCounter = 0;
	let profilesCounter = 0;
	let returnValue = {nextPage: 'https://m.facebook.com/search/str/' + config.pageId + '/likers'};
	while(returnValue.nextPage) {
		returnValue = await processSearchPage(browser, config.cookiesFile, returnValue.nextPage);
		saveProfileUrlsIntoDatabase(collection, config.pageName, returnValue.profiles);
		console.log(++pageCounter + ' search pages processed.');
		console.log((profilesCounter += returnValue.profiles.length) + ' profiles processed, ' + millisecondsToTime(Date.now() - timer) + '.');
	}
	
	await browser.close();
	process.exit(0);
})();

async function logIn(browser, cookiesFile) {
	const page = await browser.newPage();
	//page.on('console', msg => console.log('PAGE LOG:', ...msg.args));
	await loadCookies(cookiesFile, page);
	await page.setUserAgent('Mozilla/5.0 (Windows NT 6.1; Win64; x64; rv:57.0) Gecko/20100101 Firefox/57.0');

	console.log('Going to Facebook...')
	await page.goto('https://www.facebook.com/');
	console.log('Facebook reached.');

	if(!await page.$('#userNav')) {
		console.log('Log in...');
		await page.evaluate(() => {
			document.getElementById('email').value = 'francisdupont99@hotmail.fr';
			document.getElementById('pass').value = 'gratuit1';
			document.querySelector('#loginbutton > input').click();
		});
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

	await page.waitForSelector('#BrowseResultsContainer');
	console.log('Page loaded.');
	await page.waitFor(5000);

	await page.screenshot({path: 'screenshot.png', fullPage: true});

	let profiles = await listProfiles(page);

	const nextPage = await page.evaluate(() => {
		return document.querySelector('#see_more_pager > a').href;
	});

	await page.close();
	return {nextPage: nextPage, profiles: profiles};
}

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
	profiles.forEach((profile) => {
		profile.page = page;
		collection.updateOne(profile, profile, {upsert: true})
		.then((result) => {
			if(result.upsertedCount == 0)
				console.log('Profile already into database : ' + profile.url);
			else
				console.log('Profile added into database successfully : ' + profile.url);
		}, (err) => {
			console.error(err);
		});
	});
}

function loadCookies(cookiesFile, page) {
	console.log('Loading cookies...');
	return new Promise((resolve, reject) => {
		fs.readFile(cookiesFile, async (err, data) => {
			if(err && err.code != 'ENOENT')
				reject(err);

			if(!err && data)
				await page.setCookie(...JSON.parse(data));
			console.log('Cookies loaded.');
			resolve();
		});
	});
}

function saveCookies(cookiesFile, page) {
	console.log('Saving cookies...');
	return new Promise(async (resolve, reject) => {
		fs.writeFile(cookiesFile, JSON.stringify(await page.cookies()), ((err, data) => {
			if(err)
				reject(err);
			console.log('Cookies saved.');
			resolve();
		}));
	});
}

function millisecondsToTime(ms) {
	const date = new Date(ms);
	const hours = date.getUTCHours();
	const minutes = date.getUTCMinutes();
	const seconds = date.getUTCSeconds();
	return (hours < 10 ? '0' : '') + hours + ':' + (minutes < 10 ? '0' : '') + minutes + ':' + (seconds < 10 ? '0' : '') + seconds;
}