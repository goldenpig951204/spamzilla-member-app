const crypto = require("node:crypto");
const base64 = require("base-64");
const axios = require("axios");
const puppeteer = require("puppeteer");
const siteModel = require("../models/site");
const settingModel = require("../models/setting");

const decodeSess = (sess) => {
    let [signature, timeBase64, dataBase64] = sess.split("#");
    let timeBuffer = Buffer.from(timeBase64, "base64");
    let dataBuffer = Buffer.from(dataBase64, "base64");
    let data = JSON.parse(base64.decode(dataBase64));
    return {
        signature,
        timeBuffer,
        dataBuffer,
        data
    }
}
const sign = (timeSignedBuffer, dataBuffer, userAgent, ipAddr) => {
    const signature = crypto
      .createHmac("sha1", process.env.PRIVATE_KEY)
      .update(`${userAgent}\n${ipAddr}`)
      .update(timeSignedBuffer)
      .update(dataBuffer)
      .digest("base64");
    return signature;
}
const isValidSess = (sess, userAgent, ipAddr) => {
    let { timeBuffer, dataBuffer, signature } = decodeSess(sess);
    let signedResult = sign(timeBuffer, dataBuffer, userAgent, ipAddr);
    return signedResult === signature;
}
const getMainDomain = (subDomain) => {
    let segments = subDomain.split(".");
    let domain = "";
    for(let i = 0; i < segments.length; i++) {
        if (i > 0) {
            domain += `.${segments[i]}`;
        }
    }
    return domain;
}
const getFormQueryStr = (data) => {
    let items = [];
    Object.keys(data).forEach((key, idx) => {
        if (Array.isArray(data[key])) {
            for (let item of data[key]) {
                items.push(key + "[]" + "=" + encodeURIComponent(item));
            }
        } else if (typeof data[key] == "object") {
            for (let subKey in data[key]) {
                items.push(key + "[" + subKey + "]" + "=" + encodeURIComponent(data[key][subKey]));
            }
        } else {
            items.push(key + "=" + encodeURIComponent(data[key]));
        }
    });
    let dataQuery = items.join("&");
    return dataQuery;
}
const genSess = (dataBuffer, userAgent, ipAddr) => {
    let now = new Date().getTime();
    let timeSignedBuffer = Buffer.alloc(4);
    timeSignedBuffer.writeInt32LE(parseInt(now / 1000), 0);
    let signature = sign(timeSignedBuffer, dataBuffer, userAgent, ipAddr);
    return `${signature}#${timeSignedBuffer.toString("base64")}#${dataBuffer.toString("base64")}`;
}
const getMembership = async (uid, lid, siteUrl) => {
    try {
        let site = await siteModel.findOne({url: siteUrl});
        // serverLog.error(`Missing config for ${siteUrl}`);
        let { data } = await axios.get(`${siteUrl}/wp-content/plugins/indeed-membership-pro/apigate.php?ihch=${site.membershipApiKey}&action=verify_user_level&uid=${uid}&lid=${lid}`);
        return data.response;
    } catch (err) {
        return false;
    }
}
const isAccessable = async (uid, site) => {
    let setting = await settingModel.findOne();
    let check = false;
    for(let i = 0; i < setting.membershipLids.length; i++) {
        let lid = setting.membershipLids[i];
        let result = await getMembership(uid, lid, site);
        if (result != 0) {
            check = true;
            break;
        }
    }
    return check;
}
const spamzillaAutoLogin = async (email, password) => {
    return new Promise (async (resolve, reject) => {
        const browser = await puppeteer.launch({
            headless: false, timeout: 100000
        });
        const page = await browser.newPage();
        await page.goto('https://www.spamzilla.io/account/login/', {waitUntil: 'load', timeout: 100000});
        await page.focus("#loginform-email").then(async () => {
            await page.keyboard.type(email, { delpay: 100 });
        });
        await page.focus("#loginform-password").then(async () => {
            await page.keyboard.type(password, { delpay: 100 });
        });
        await Promise.all([
            page.waitForNavigation({waitUntil: 'load', timeout : 100000}),
            page.click('.custom-submit-btn')
        ]).then(async (result) => {
            if (/account\/login/.test(page.url())) {
                await browser.close(true);
                resolve(false);
            } else {
                let cookies = await page.cookies();
                await browser.close(true);
                let cookie = "";
                for( let idx in cookies) {
                    cookie += cookies[idx].name + "=" + cookies[idx].value + "; ";
                }
                
                await settingModel.findOneAndUpdate(null, {
                    spamzillaCookie: cookie
                }, {
                    upsert: true
                });
                resolve(true);
            }
        });
    });
}
module.exports = {
    decodeSess,
    isValidSess,
    genSess,
    isAccessable,
    getMainDomain,
    getFormQueryStr,
    spamzillaAutoLogin
}