/* ═══════════════════════════════════════════════════════════════════════
   Zoom Meeting Scheduler — Google Sheets Database (Apps Script backend)
   ═══════════════════════════════════════════════════════════════════════
   This file does NOT change any booking/approval/calendar logic. It only
   gives script.js somewhere durable and shared to read/write its data,
   instead of each browser's own localStorage.

   SHEETS CREATED (auto-created by setupSheets):
     - Bookings   → mirrors the `bookings` array in script.js
     - Accounts   → mirrors the `zoomAccounts` array in script.js
     - Settings   → key/value store, currently just the admin email

   SETUP (one time):
     1. Create a new Google Sheet (sheets.new).
     2. Extensions ▸ Apps Script. Delete any starter code, paste this file
        in as Code.gs.
     3. Run the `setupSheets` function once (▶ button, pick "setupSheets"
        from the dropdown). Approve the permissions prompt.
        This creates the 3 tabs and seeds them with the same sample data
        script.js ships with, so both stay in sync on first load.
     4. Deploy ▸ New deployment ▸ type "Web app".
          - Execute as: Me
          - Who has access: Anyone
        Click Deploy, authorize again if asked, and copy the Web App URL
        (ends in /exec).
     5. Paste that URL into DB_API_URL near the top of script.js.

   NOTE: any time you change the Apps Script code, you must create a NEW
   deployment version (Deploy ▸ Manage deployments ▸ ✎ ▸ New version) for
   the change to actually go live at the same /exec URL.
   ═══════════════════════════════════════════════════════════════════════ */

const BOOKING_HEADERS = ['id','title','name','agency','date','shift','start','end','pax',
  'accountId','recurring','freq','count','notes','status','submitted','autoDeniedBy'];

const ACCOUNT_HEADERS = ['id','name','capacity','status','email','expiry','notes','created'];

/* Columns that hold date/time strings (YYYY-MM-DD or HH:MM). Google Sheets
   auto-detects these and silently converts them into real Date objects,
   which then get serialized back to the browser as full ISO timestamps
   like "2026-07-08T16:00:00.000Z" instead of "2026-07-08" — and shifted
   to UTC, which can even bump the date by a day. That breaks every place
   script.js compares dates as plain strings (calendar, conflict checks,
   getEffDates), so bookings that ARE on the sheet look like they "didn't
   sync." Setting these columns' number format to plain text prevents the
   auto-conversion at the source. */
const BOOKING_DATE_COLS = ['date','start','end','submitted'];
const ACCOUNT_DATE_COLS = ['expiry','created'];

function forcePlainTextColumns(sheet, headers, dateCols){
  dateCols.forEach(function(col){
    const idx = headers.indexOf(col);
    if(idx<0) return;
    sheet.getRange(1, idx+1, sheet.getMaxRows(), 1).setNumberFormat('@STRING@');
  });
}

/* ── One-time setup: creates the 3 tabs + seeds default data ── */
function setupSheets(){
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const bookingsSheet = ss.getSheetByName('Bookings') || ss.insertSheet('Bookings');
  bookingsSheet.clear();
  bookingsSheet.appendRow(BOOKING_HEADERS);
  forcePlainTextColumns(bookingsSheet, BOOKING_HEADERS, BOOKING_DATE_COLS);
  const defaultBookings = [
    ['BK-001','ICT Summit 2026','Ana Reyes','DICT IV-A','2026-07-07','AM','07:00','12:00','100','ACC-001',false,'',0,'','APPROVED','2026-06-28',''],
    ['BK-002','Data Privacy Seminar','Ben Cruz','NPC','2026-07-10','BOTH','07:00','18:00','300','ACC-002',false,'',0,'Projector','PENDING','2026-06-30',''],
    ['BK-003','Weekly Standup','Clara Tan','DICT Central','2026-07-01','AM','08:00','09:00','100','ACC-001',true,'weekly',4,'','APPROVED','2026-06-25',''],
    ['BK-004','Cybersecurity Forum','Dan Uy','ICTD Manila','2026-07-15','PM','13:00','17:00','500','ACC-003',false,'',0,'Livestream','PENDING','2026-07-01',''],
    ['BK-005','Annual Planning','Eva Santos','DICT Calabarzon','2026-08-05','BOTH','07:00','18:00','300','ACC-002',false,'',0,'','APPROVED','2026-07-03',''],
  ];
  defaultBookings.forEach(r=>bookingsSheet.appendRow(r));

  const accountsSheet = ss.getSheetByName('Accounts') || ss.insertSheet('Accounts');
  accountsSheet.clear();
  accountsSheet.appendRow(ACCOUNT_HEADERS);
  forcePlainTextColumns(accountsSheet, ACCOUNT_HEADERS, ACCOUNT_DATE_COLS);
  const defaultAccounts = [
    ['ACC-001','Account Name 1','100','active','zoom-100@yourdomain.com','2027-01-01','Primary 100-pax license.','2026-01-01'],
    ['ACC-002','Account Name 2','300','active','zoom-300@yourdomain.com','2027-01-01','Used for large seminars.','2026-01-01'],
    ['ACC-003','Account Name 3','500','active','zoom-500@yourdomain.com','2027-01-01','Full-capacity events only.','2026-01-01'],
  ];
  defaultAccounts.forEach(r=>accountsSheet.appendRow(r));

  const settingsSheet = ss.getSheetByName('Settings') || ss.insertSheet('Settings');
  settingsSheet.clear();
  settingsSheet.appendRow(['key','value']);
  settingsSheet.appendRow(['adminEmail','admin@yourdomain.com']);

  SpreadsheetApp.flush();
  Logger.log('Sheets created and seeded.');
}

/* ── Helpers ── */
function getSheet(name){
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if(!sheet) throw new Error(`Sheet "${name}" not found — run setupSheets() first.`);
  return sheet;
}

/* Undo Sheets' auto-conversion for values that were already turned into
   real Date objects before the plain-text column format was in place
   (i.e. existing rows saved before this fix). Converts back to the plain
   "YYYY-MM-DD" or "HH:MM" string form script.js expects, using LOCAL
   time (not UTC) so dates don't shift by a day. Leaves already-plain
   strings untouched. */
function normalizeDateLikeValue(val, isTimeOnly){
  if(!(val instanceof Date)) return val;
  const tz = Session.getScriptTimeZone() || SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  if(isTimeOnly) return Utilities.formatDate(val, tz, 'HH:mm');
  return Utilities.formatDate(val, tz, 'yyyy-MM-dd');
}

function sheetToObjects(sheet, headers){
  const values = sheet.getDataRange().getValues();
  values.shift(); // drop header row
  const timeCols = {start:true, end:true};
  return values
    .filter(row=>row[0]!=='') // skip blank rows
    .map(row=>{
      const obj = {};
      headers.forEach((h,i)=>{
        let v = row[i];
        if(BOOKING_DATE_COLS.indexOf(h)>=0 || ACCOUNT_DATE_COLS.indexOf(h)>=0){
          v = normalizeDateLikeValue(v, !!timeCols[h]);
        }
        if(h==='pax' && v!==''){ v = String(v); }
        obj[h] = v;
      });
      // Sheets stores booleans/numbers natively; JSON.stringify handles them fine.
      // Normalize blanks back to empty string (Sheets sometimes gives them as '').
      if('autoDeniedBy' in obj && !obj.autoDeniedBy) delete obj.autoDeniedBy;
      return obj;
    });
}

function objectsToSheet(sheet, headers, arr){
  sheet.clear();
  sheet.appendRow(headers);
  const dateCols = sheet.getName()==='Bookings' ? BOOKING_DATE_COLS : ACCOUNT_DATE_COLS;
  forcePlainTextColumns(sheet, headers, dateCols);
  if(arr.length){
    const rows = arr.map(o=>headers.map(h=>o[h] === undefined || o[h] === null ? '' : o[h]));
    sheet.getRange(2,1,rows.length,headers.length).setValues(rows);
  }
}

/* Merge-safe write for Bookings: instead of blindly overwriting the sheet
   with whatever list a single device happened to have in localStorage
   (which caused bookings from other devices to silently disappear when
   two people used the app around the same time), this:
     1) generates a real server-side ID for any incoming booking that
        doesn't already have one that exists on the sheet, so two devices
        never stomp on each other with a duplicate "next number" ID, and
     2) upserts each incoming booking by id into the FULL current sheet
        contents, rather than replacing the sheet outright.
   Returns the merged array (including freshly assigned ids) so the
   caller can hand real IDs back to the browser that submitted them. */
function upsertBookings(incoming){
  const sheet = getSheet('Bookings');
  const existing = sheetToObjects(sheet, BOOKING_HEADERS);
  const byId = {};
  existing.forEach(function(o){ byId[o.id]=o; });

  var maxNum = 0;
  existing.forEach(function(o){
    var m = /^BK-(\d+)$/.exec(o.id||'');
    if(m) maxNum = Math.max(maxNum, parseInt(m[1],10));
  });

  var assigned = [];
  incoming.forEach(function(o){
    var id = o.id;
    var looksLikeRealId = id && /^BK-\d+$/.test(id) && byId[id];
    if(!looksLikeRealId){
      maxNum += 1;
      id = 'BK-'+String(maxNum).padStart(3,'0');
    }
    var rec = Object.assign({}, o, { id: id });
    byId[id] = rec;
    assigned.push(rec);
  });

  var merged = existing.slice();
  assigned.forEach(function(rec){
    var idx = merged.findIndex(function(o){ return o.id===rec.id; });
    if(idx>=0) merged[idx]=rec; else merged.push(rec);
  });

  objectsToSheet(sheet, BOOKING_HEADERS, merged);
  return assigned;
}

function jsonOut(obj){
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ── Reads: GET ?action=bookings | accounts | settings ── */
function doGet(e){
  const action = e.parameter.action;
  try{
    if(action==='bookings') return jsonOut(sheetToObjects(getSheet('Bookings'), BOOKING_HEADERS));
    if(action==='accounts') return jsonOut(sheetToObjects(getSheet('Accounts'), ACCOUNT_HEADERS));
    if(action==='settings'){
      const rows = getSheet('Settings').getDataRange().getValues();
      const map = {}; rows.forEach(r=>{ if(r[0]) map[r[0]] = r[1]; });
      return jsonOut({ adminEmail: map.adminEmail || '' });
    }
    return jsonOut({ error: 'Unknown action: '+action });
  }catch(err){
    return jsonOut({ error: String(err) });
  }
}

/* ── Writes: POST body = { action, payload } ──
   Sent as Content-Type: text/plain from the browser to avoid CORS
   preflight (Apps Script can't respond to OPTIONS requests). */
function doPost(e){
  try{
    const body = JSON.parse(e.postData.contents);
    const action = body.action;
    const payload = body.payload;

    if(action==='saveBookings'){
      // payload is the full array the browser has locally. We no longer
      // trust it as the whole truth (a device with a stale local cache
      // would otherwise erase other devices' newer bookings) — instead we
      // upsert each row by id into whatever is currently on the sheet.
      const merged = upsertBookings(payload);
      return jsonOut({ ok:true, bookings: merged });
    }
    if(action==='addBooking'){
      // Preferred path for creating a single new booking: payload is one
      // booking object (id may be blank). The server assigns a real id
      // and appends it without touching any other rows.
      const assigned = upsertBookings([payload]);
      return jsonOut({ ok:true, booking: assigned[0] });
    }
    if(action==='saveAccounts'){
      objectsToSheet(getSheet('Accounts'), ACCOUNT_HEADERS, payload);
      return jsonOut({ ok:true });
    }
    if(action==='setAdminEmail'){
      const sheet = getSheet('Settings');
      const rows = sheet.getDataRange().getValues();
      let found = false;
      for(let i=1;i<rows.length;i++){
        if(rows[i][0]==='adminEmail'){ sheet.getRange(i+1,2).setValue(payload.email); found = true; break; }
      }
      if(!found) sheet.appendRow(['adminEmail', payload.email]);
      return jsonOut({ ok:true });
    }
    return jsonOut({ error: 'Unknown action: '+action });
  }catch(err){
    return jsonOut({ error: String(err) });
  }
}