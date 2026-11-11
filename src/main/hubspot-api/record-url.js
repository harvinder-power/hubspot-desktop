// Web-app record URLs, measured on the real app: /contacts/<portalId>/record/<objectTypeId>/<recordId>.
const OBJECT_TYPE_IDS = Object.freeze({
  contacts: '0-1',
  companies: '0-2',
  deals: '0-3',
  tickets: '0-5',
  tasks: '0-27',
});

function recordUrl({ appOrigin, portalId, type, id }) {
  const typeId = Object.hasOwn(OBJECT_TYPE_IDS, type) ? OBJECT_TYPE_IDS[type] : null;
  if (!typeId || !appOrigin || !portalId || !id) return null;
  return `${appOrigin}/contacts/${encodeURIComponent(portalId)}/record/${typeId}/${encodeURIComponent(id)}`;
}

module.exports = { OBJECT_TYPE_IDS, recordUrl };
