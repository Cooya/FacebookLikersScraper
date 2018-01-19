const request = require('request');
const cheerio = require('cheerio');

const TOOL_URL = 'https://findmyfbid.in/';

module.exports = async (profileUrl) => {
	const token = await getToken();
	return getFacebookId(profileUrl, token);
};

function getToken() {
	return new Promise((resolve, reject) => {
		request.get({
			url: TOOL_URL
		}, (err, response) => {
			if(err)
				reject(err);
			else {
				const $ = cheerio.load(response.body);
				const input = $('#findmyfbid input[name="csrfmiddlewaretoken"]');
				if(!input.length)
					reject('No input');
				else
					resolve(input.val());
			}
		});
	});
}

function getFacebookId(profileUrl, token) {
	return new Promise((resolve, reject) => {
		request.post({
			url: TOOL_URL,
			headers: {
				'Referer': 'https://findmyfbid.in/',
				'Cookie': 'csrftoken=' + token,
				followRedirect: false
			},
			form: {
				csrfmiddlewaretoken: token,
				fburl:profileUrl
			}
		}, (err, response) => {
			if(err)
				reject(err);
			else
				resolve(response.headers.location.match(/[0-9]+/)[0]);
		});
	});
}