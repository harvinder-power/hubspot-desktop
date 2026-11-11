// Private-app scopes each client function needs. Read-only scopes only.
// Sources and unverified rows: docs/hubspot-api.md.
const REQUIRED_SCOPES = Object.freeze({
  account: Object.freeze([]),
  owners: Object.freeze(['crm.objects.owners.read']),
  tasksDue: Object.freeze(['crm.objects.contacts.read']),
  upcomingMeetings: Object.freeze(['crm.objects.contacts.read']),
  search: Object.freeze({
    contacts: Object.freeze(['crm.objects.contacts.read']),
    companies: Object.freeze(['crm.objects.companies.read']),
    deals: Object.freeze(['crm.objects.deals.read']),
  }),
});

module.exports = { REQUIRED_SCOPES };
