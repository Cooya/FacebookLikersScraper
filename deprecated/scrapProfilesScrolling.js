const fs = require('fs');
const MongoClient = require('mongodb').MongoClient;
const puppeteer = require('puppeteer');

(async () => {
	const timer = Date.now();
	let profilesCounter = 0;
	const config = require('./config.json');

	const collection = await getDatabaseCollection(config.databaseUrl, config.collectionName);
	console.log('Collection selected.');

	const browser = await puppeteer.launch({args: ['--no-sandbox', '--disable-setuid-sandbox']});
	const page = await browser.newPage();
	//page.on('console', msg => console.log('PAGE LOG:', ...msg.args));

	await loadCookies(config.cookiesFile, page);

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
		await saveCookies(config.cookiesFile, page);
	}
	else
		console.log('Already logged in.');

	console.log('Going to search page...');
	await page.goto('https://www.facebook.com/search/str/' + config.pageId + '/likers/intersect');
	await page.waitForSelector('#initial_browse_result');
	console.log('Over search page.');

	let profileUrls = await listProfileUrls(page);
	saveProfileUrlsIntoDatabase(collection, config.pageName, profileUrls);
	profilesCounter += profileUrls.length;
	console.log(profilesCounter + ' profiles processed, ' + millisecondsToTime(Date.now() - timer) + '.');

	await page.evaluate(() => {
		document.getElementById('BrowseResultsContainer').remove();
		document.getElementById('u_ps_0_3_0_browse_result_below_fold').remove();
	});

	for(let i = 0; i > -1; ++i) {
		console.log(i + ' : scrolling to the bottom of the page...');
		await page.evaluate(() => {
			window.scrollTo(0, document.body.scrollHeight);
		});

		console.log(i + ' : waiting for new batch...');
		await page.waitForSelector('#fbBrowseScrollingPagerContainer' + i);
		await page.waitFor(5000);

		await page.screenshot({path: 'screenshot.png', fullPage: true});

		profileUrls = await listProfileUrls(page, '#fbBrowseScrollingPagerContainer' + i);
		saveProfileUrlsIntoDatabase(collection, config.pageName, profileUrls);
		profilesCounter += profileUrls.length;

		i++;

		profileUrls = await listProfileUrls(page, '#fbBrowseScrollingPagerContainer' + i);
		saveProfileUrlsIntoDatabase(collection, config.pageName, profileUrls);
		profilesCounter += profileUrls.length;
		console.log(profilesCounter + ' profiles processed, ' + millisecondsToTime(Date.now() - timer) + '.');

		console.log(i + ' : removing the DOM element...');
		const removedElements = await page.evaluate((i) => {
			var counter = 0;
			var div;
			for(var k = i - 3; k <= i; ++k) {
				div = document.getElementById('fbBrowseScrollingPagerContainer' + k);
				if(div) {
					div.remove();
					counter++;
				}
			}
			return counter;
		}, i);
		console.log(i + ' : ' + removedElements + ' DOM elements removed.');
	}

	await page.screenshot({path: 'screenshot.png', fullPage: true});
	await browser.close();
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

async function listProfileUrls(page, divId) {
	console.log('Getting user id list...');
	const selector = divId ? divId + ' a._32mo' : 'a._32mo';
	return await page.evaluate((selector) => {
		var list = [];
		var elements = document.querySelectorAll(selector);
		for(var i = 0; i < elements.length; ++i)
			list.push(elements[i].href);
		return list;
	}, selector);
	console.log('Done.');
}

function saveProfileUrlsIntoDatabase(collection, page, profileUrls) {
	profileUrls.forEach((profileUrl) => {
		const doc = {page: page, url: profileUrl.replace(/[?|&]ref=.*/, '')};
		collection.updateOne(doc, doc, {upsert: true})
		.then((result) => {
			if(result.upsertedCount == 0)
				console.log('Profile already into database : ' + doc.url);
			else
				console.log('Profile added into database successfully : ' + doc.url);
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