import { readFileSync, writeFileSync } from 'fs';
import { XMLParser } from 'fast-xml-parser';

function parseXMLtoJSON(xmlFilePath, jsonlFilePath) {
  const xmlData = readFileSync(xmlFilePath, 'utf-8');

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    parseNodeValue: true,
    parseAttributeValue: true,
  });

  const jsonObj = parser.parse(xmlData);

  const cards = [];
  if (jsonObj.CARDS && jsonObj.CARDS.SET) {
    jsonObj.CARDS.SET.CARD.forEach((card) => {
      let badges = card.BADGES.BADGE;
      let fmtBadges = {};

      if (badges) {
        if (Array.isArray(badges)) {
          badges.forEach(badge => {
            if (typeof badge === "object") {
              fmtBadges[badge['@_type']] = badge['#text'];
            } else {
              if (badge.includes('(')) {
                let badgeName = badge.split('(');
                let badgeBase = badgeName[0].trim();
                if (badgeBase === "Easter Eggs") badgeBase = "Easter Egg";
                const count = badgeName[1].replace('x', '').replace(')', '');
                fmtBadges[badgeBase] = parseInt(count);
              } else {
                fmtBadges[badge] = 1;
              }
            }
          });
        } else {
          if (typeof badges === "object") {
            fmtBadges[badges['@_type']] = badges['#text'];
          } else {
            if (badges.includes('(')) {
              let badgeName = badges.split('(');
              let badgeBase = badgeName[0].trim();
              if (badgeBase === "Easter Eggs") badgeBase = "Easter Egg";
              const count = badgeName[1].replace('x', '').replace(')', '');
              fmtBadges[badgeBase] = parseInt(count);
            } else {
              fmtBadges[badges] = 1;
            }
          }
        }
      }

      let trophies = card.TROPHIES.TROPHY;
      let fmtTrophies = {};

      if (trophies) {
        if (Array.isArray(trophies)) {
          trophies.forEach(trophy => {
            const trophyType = trophy['@_type'];
            const trophyValue = parseInt(trophy['#text']);
            fmtTrophies[trophyType] = trophyValue;
          });
        } else {
          fmtBadges[trophies['@_type']] = parseInt(trophies['#text']);
        }
      }

      const formattedCardData = {
        ID: card.ID,
        NAME: card.NAME,
        TYPE: card.TYPE,
        MOTTO: card.MOTTO,
        CATEGORY: card.CATEGORY,
        REGION: card.REGION,
        FLAG: card.FLAG,
        CARDCATEGORY: card.CARDCATEGORY,
        DESCRIPTION: card.DESCRIPTION,
        BADGES: fmtBadges || {},
        TROPHIES: fmtTrophies || {},
      };

      cards.push(formattedCardData);
    });
  }

  writeFileSync(jsonlFilePath, cards.map(card => JSON.stringify(card)).join('\n'), 'utf-8');
}

['1','2', '3', '4'].forEach(num => {
  parseXMLtoJSON(`cardlist_S${num}.xml`, `cardlist_S${num}.jsonl`);
})
