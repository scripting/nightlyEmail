var myVersion = "0.4.11", myProductName = "scriptingNightlyEmail"; 

const utils = require ("daveutils");
const rss = require ("daverss");
const mail = require ("davemail");
const dateFormat = require ("dateformat");
const s3 = require ("daves3");
const request = require ("request");
const feedRead = require ("davefeedread");
const urlParser = require ("url");
const fs = require ("fs");

var config = { 
	urlGitHubPath: "https://raw.githubusercontent.com/scripting/Scripting-News/master/blog/pages/",
	pathDestRssFile: "/scripting.com/rssNightly.xml",
	pathDestJsonFile: "/scripting.com/rssNightly.json",
	fnameFeedJson: "rss.json",
	userPrefsFolder: "data/", //8/18/19 by DW
	
	urlLinkblogFeed: "http://data.feedland.org/feeds/davewiner.xml", //4/18/23 by DW
	feedReadTimeOutSecs: 30, //8/23/19 by DW
	
	emailPrefsFile: "../scriptingmaillist/data/emailPrefs.json", //8/28/19 by DW
	emailUnsubUrl: "http://scripting.com/email/?unsub=true&email=[%email%]", //8/28/19 by DW
	emailCopyright: "Copyright 1994-2024 Dave Winer.", //1/5/22 by DW
	
	dataFilePath: "data/",
	timeOutSecs: 30,
	userAgent: myProductName + " v" + myVersion,
	blogTitle: "Scripting News",
	rssTitle: "Scripting News for email",
	rssLink: "http://scripting.com/",
	rssItemAuthor: "dave.winer@gmail.com (Dave Winer)",
	rssDescription: "A feed containing one item per day with all the posts on Scripting News for that day.",
	rssLanguage: "en-us",
	rssGenerator: myProductName + " v" + myVersion,
	rssDocs: "http://cyber.law.harvard.edu/rss/rss.html",
	rssMaxItems: 50,
	appDomain: "scripting.com",
	flRssCloudEnabled:  true,
	rssCloudDomain:  "rpc.rsscloud.io",
	rssCloudPort:  5337,
	rssCloudPath: "/pleaseNotify",
	rssCloudRegisterProcedure:  "",
	rssCloudProtocol:  "http-post"
	};
var stats = {
	whenLastCheck: new Date (0),
	ctChecks: 0,
	whenLastUpdate: new Date (0),
	ctUploads: 0,
	whenLastUpload: new Date (0),
	ctUpdates: 0,
	ctUploadErrors: 0,
	ctConsecutiveUploadErrors: 0,
	whenLastUploadError: new Date (0),
	whenLastSave: new Date (0),
	ctSaves: 0,
	rssHistory: [],
	};
var mailStats = {
	ctSaves: 0,
	whenLastSave: new Date (0),
	ctEmailsSent: 0,
	people: {
		}
	}
const fnameStats = "stats.json", fnameConfig = "config.json", fnameRss = "rss.xml", fnameJson = "rss.json", fnameMailStats = "mailStats.json";
var flStatsChanged = false, flRssChanged = false, flMailStatsChanged = false;
var currentHour = new Date ().getHours ();
var emailTemplateFile = "emailtemplate.html";

function mailStatsChanged () {
	flMailStatsChanged = true;
	}
function logMailSend (email) {
	var now = new Date ();
	var obj = {
		ct: 0,
		whenFirst: now,
		whenLast: now
		};
	var jstruct = mailStats.people [email];
	if (jstruct !== undefined) {
		for (var x in jstruct) {
			obj [x] = jstruct [x];
			}
		}
	obj.whenLast = now;
	obj.ct++;
	mailStats.people [email] = obj;
	mailStats.ctEmailsSent++;
	mailStatsChanged ();
	}
function getLinkblogTextForTheDay (theDay, callback) {
	function getDomainFromUrl (url) {
		var parsedUrl = urlParser.parse (url);
		var s = parsedUrl.hostname;
		var ct = utils.stringCountFields (s, ".");
		if (ct >= 3) {
			s = utils.stringNthField (s, ".", ct - 1) + "." + utils.stringNthField (s, ".", ct);
			}
		return (s);
		}
	function cleanDescription (desc) { //4/18/23 by DW
		if (utils.beginsWith (desc, "<p>")) {
			desc = utils.stringDelete (desc, 1, 3);
			}
		if (utils.endsWith (desc, "</p>\n")) {
			desc = utils.stringMid (desc, 1, desc.length - 5);
			}
		return (desc);
		}
	feedRead.parseUrl (config.urlLinkblogFeed, config.feedReadTimeOutSecs, function (err, theFeed) {
		var htmltext = "";
		function add (s) {
			htmltext += s + "\n";
			}
		if (err) {
			console.log ("getLinkblogTextForTheDay: err.message == " + err.message);
			}
		else {
			var ctitems = 0;
			theFeed.items.forEach (function (item) {
				if (utils.sameDay (theDay, item.pubDate)) {
					var pubdatestring = new Date (item.pubDate).toLocaleTimeString ();
					
					var link = "";
					if (typeof item.link == "string") { //1/13/23 by DW
						link = "<a href=\"" + item.link + "\">" + getDomainFromUrl (item.link) + "</a>";
						}
					
					add ("<div class=\"divLinkblogItem\">" + cleanDescription (item.description) + " " + link + "</div>"); //4/18/23 by DW
					ctitems++;
					}
				});
			if (ctitems > 0) {
				htmltext = "<h4>Linkblog items for the day.</h4>" + htmltext;
				}
			}
		callback (htmltext);
		});
	}
function readMailList (callback) {
	fs.readFile (config.emailPrefsFile, function (err, jsontext) {
		if (err) {
			console.log ("readMailList: err.message == " + err.message);
			callback (err);
			}
		else {
			try {
				var theList = JSON.parse (jsontext);
				callback (undefined, theList);
				}
			catch (err) {
				console.log ("readMailList: err.message == " + err.message);
				callback (err);
				}
			}
		});
	}
function mailItem (item, flJustTest, callback) { //8/8/19 by DW 
	getLinkblogTextForTheDay (utils.dateYesterday (item.when), function (linkblogtext) {
		function hack (s) {
			const replacetable = {
				"<ul class=\"ulLevel0\">": "<div class=\"ulLevel0\">",
				"<li": "<div class=\"divPgf\"",
				"</li>": "</div>"
				};
			s = utils.multipleReplaceAll (s, replacetable, false, "", "");
			return (s);
			}
		readMailList (function (err, theList) {
			if (flJustTest) { //8/20/19 by DW
				theList = {
					"dave.winer@gmail.com": {
						"when": new Date (0),
						"emailActual": "Dave.Winer@gmail.com",
						"enabled": true
						}
					};
				}
			if (!err) {
				fs.readFile (emailTemplateFile, function (err, emailTemplate) {
					if (!err) {
						for (var x in theList) {
							let email = x; //so it can be used in mail.send's callback
							let listitem = theList [email];
							let emailActual = (listitem.emailActual !== undefined) ? listitem.emailActual : email; //8/30/19 by DW
							if (listitem.enabled) {
								var params = new Object ();
								utils.copyScalars (item, params);
								params.unsubUrl = utils.replaceAll (config.emailUnsubUrl, "[%email%]", emailActual); //8/27/19 by DW
								params.readOnWebUrl = item.link;
								params.snarkySlogan = utils.getRandomSnarkySlogan (); //9/1/19 by DW
								params.howLongBlogRunning = "This blog has been running for: " + utils.howLongSinceStartAsString ("10/7/1994, 12:00 PDT"); //9/12/19 by DW
								params.whenSent = new Date ().toLocaleString ();
								params.copyright = config.emailCopyright;
								params.linkblogtext = linkblogtext; //8/23/19 by DW
								var mailtext = utils.multipleReplaceAll (emailTemplate.toString (), params, false, "[%", "%]");
								mail.send (emailActual, item.title, hack (mailtext), "dave@scripting.com", function (err, data) {
									if (!err) {
										console.log ("mailItem: mail sent to " + emailActual);
										logMailSend (emailActual);
										}
									fs.writeFile ("lastmail.html", mailtext, function (err) {
										});
									});
								}
							}
						}
					});
				}
			});
		});
	}

function statsChanged () {
	flStatsChanged = true;
	}
function rssChanged () {
	flRssChanged = true;
	flStatsChanged = true;
	}
function buildRss (callback) {
	var headElements = {
		title: config.rssTitle,
		link: config.rssLink,
		description: config.rssDescription,
		language: config.rssLanguage,
		generator: config.rssGenerator,
		docs: config.rssDocs,
		maxFeedItems: config.rssMaxItems,
		appDomain: config.appDomain,
		flRssCloudEnabled:  config.flRssCloudEnabled,
		rssCloudDomain:  config.rssCloudDomain,
		rssCloudPort:  config.rssCloudPort,
		rssCloudPath: config.rssCloudPath,
		rssCloudRegisterProcedure:  config.rssCloudRegisterProcedure,
		rssCloudProtocol:  config.rssCloudProtocol
		}
	function writeJsonVersion (headElements, rssHistory) {
		var jstruct = {
			headElements: headElements, 
			items: rssHistory
			}
		var jsontext = utils.jsonStringify (jstruct);
		fs.writeFile (fnameJson, jsontext, function () {
			});
		s3.newObject (config.pathDestJsonFile, jsontext, "application/json", "public-read", function (err, data) {
			if (err) {
				console.log ("writeJsonVersion: err.message == " + err.message);
				}
			else {
				}
			});
		}
	var xmltext = rss.buildRssFeed (headElements, stats.rssHistory);
	fs.writeFile (fnameRss, xmltext, function () {
		});
	s3.newObject (config.pathDestRssFile, xmltext, "text/xml", "public-read", function (err, data) {
		if (err) {
			console.log ("buildRss: err.message == " + err.message);
			}
		else {
			}
		});
	writeJsonVersion (headElements, stats.rssHistory);
	if (callback !== undefined) {
		callback (xmltext);
		}
	}



function checkForTheHtml (callback) {
	var now = new Date ();
	function getCurrentHtml (relpath, callback) {
		function readHtmlFromGitHub (relpath, callback) {
			var theRequest = {
				method: "GET",
				url: config.urlGitHubPath + relpath,
				headers: {
					"User-Agent": config.userAgent
					}
				};
			request (theRequest, function (err, response, body) { 
				if (!err && response.statusCode == 200) {
					callback (body.toString ());
					}
				else {
					callback (undefined);
					}
				});
			}
		function readHtmlFromS3 (relpath, callback) {
			const url = "http://scripting.com/data/pages/" + relpath;
			request (url, function (err, response, htmltext) {
				if (!err && response.statusCode == 200) {
					callback (htmltext);
					}
				else {
					callback (undefined);
					}
				});
			}
		readHtmlFromS3 (relpath, function (htmltext) {
			if (htmltext !== undefined) {
				callback (htmltext)
				}
			else {
				readHtmlFromGitHub (relpath, function (htmltext) {
					if (htmltext !== undefined) {
						callback (htmltext)
						}
					});
				}
			});
		}
	function pushItem (title, pubDate, text) {
		var urlPublic = "http://scripting.com/" + relpath;
		var item = {
			title: title,
			text: text,
			when: pubDate,
			link: urlPublic,
			author: config.rssItemAuthor, //7/31/19 by DW
			guid: {
				flPermalink: true,
				value: urlPublic
				}
			};
		stats.rssHistory.unshift (item);
		while (stats.rssHistory.length > config.rssMaxItems) {
			stats.rssHistory.pop ();
			}
		statsChanged ();
		rssChanged ();
		mailItem (item, false); //8/8/19 by DW
		}
	if (!utils.sameDay (now, stats.whenLastUpdate)) {
		var yesterday = utils.dateYesterday (now);
		var itemtitle = config.blogTitle + ": " + dateFormat (yesterday, "dddd, mmmm d, yyyy");
		var relpath = utils.getDatePath (yesterday, false) + ".html";
		function gotTheHtml (htmltext) {
			console.log (now.toLocaleTimeString () + ": htmltext.length == " + htmltext.length + "\n");
			stats.whenLastUpdate = now;
			stats.ctUpdates++;
			pushItem (itemtitle, now, htmltext);
			var f = config.dataFilePath + relpath;
			utils.sureFilePath (f, function () {
				fs.writeFile (f, htmltext, function () {
					});
				});
			}
		getCurrentHtml (relpath, function (htmltext) {
			if (htmltext !== undefined) {
				gotTheHtml (htmltext)
				}
			});
		}
	}
function everyHour () {
	var now = new Date ();
	console.log ("\n" + myProductName + " v" + myVersion + ": " + now.toLocaleTimeString ());
	}
function everyMinute () {
	checkForTheHtml ();
	 var h = new Date ().getHours ();
	if (currentHour != h) {
		currentHour = h;
		everyHour ();
		}
	}
function everySecond () {
	if (flStatsChanged) {
		flStatsChanged = false;
		stats.whenLastSave = new Date ();
		stats.ctSaves++;
		fs.writeFile (fnameStats, utils.jsonStringify (stats), function (err) {
			if (err) {
				console.log ("everySecond: err.message == " + err.message);
				}
			});
		}
	if (flRssChanged) {
		flRssChanged = false;
		buildRss ();
		}
	if (flMailStatsChanged) {
		flMailStatsChanged = false;
		mailStats.whenLastSave = new Date ();
		mailStats.ctSaves++;
		fs.writeFile (fnameMailStats, utils.jsonStringify (mailStats), function (err) {
			if (err) {
				console.log ("everySecond: err.message == " + err.message);
				}
			});
		}
	}


console.log ("\n" + myProductName + " v" + myVersion + ".\n");
function runEveryMinute (callback) { //run callback at the top of each minute, with no drift
	var whenLastEveryMinute = new Date ();
	function secondsSince (when) { 
		var now = new Date ();
		when = new Date (when);
		return ((now - when) / 1000);
		}
	function everySecond () {
		var now = new Date ();
		if (now.getSeconds () == 0) {
			whenLastEveryMinute = now;
			callback ();
			}
		else {
			if (secondsSince (whenLastEveryMinute) > 60) {
				whenLastEveryMinute = now;
				callback ();
				}
			}
		}
	setInterval (everySecond, 1000);
	}

fs.readFile (fnameMailStats, function (err, data) {
	if (!err) {
		const jstruct = JSON.parse (data);
		for (var x in jstruct) {
			mailStats [x] = jstruct [x];
			}
		}
	fs.readFile (fnameStats, function (err, data) {
		if (!err) {
			const jstruct = JSON.parse (data);
			for (var x in jstruct) {
				stats [x] = jstruct [x];
				}
			}
		fs.readFile (fnameConfig, function (err, data) {
			if (!err) {
				const jstruct = JSON.parse (data);
				for (var x in jstruct) {
					config [x] = jstruct [x];
					}
				}
			checkForTheHtml ();
			runEveryMinute (everyMinute); //2/14/21 by DW
			setInterval (everySecond, 1000); 
			});
		});
	});


