// A shared listing link (/l/<id>/) made before its preview page was built: go straight to the listing.
const match = location.pathname.match(/^\/l\/([0-9a-f-]{36})\/?$/i);
if (match) location.replace(`/listing.html?id=${match[1]}`);
