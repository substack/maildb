var sublevel = require('level-sublevel/bytewise');
var bytewise = require('bytewise');
var cas = require('content-addressable-store');
var through = require('through2');
var headers = require('parse-header-stream');
var batch = require('level-create-batch');
var split = require('split');

module.exports = Mail;

function Mail (db, opts) {
    if (!(this instanceof Mail)) return new Mail(db, opts);
    if (!opts) opts = {};
    this.db = sublevel(db, {
        keyEncoding: bytewise,
        valueEncoding: 'json'
    });
    this.store = cas(opts.dir || './mail.db');
}

Mail.prototype.save = function (from, rcpts) {
    var self = this;
    if (!Array.isArray(rcpts)) rcpts = [ rcpts ];
    var rcpts = rcpts.filter(Boolean).map(function (s) {
        return String(s).toLowerCase();
    });
    from = from.toLowerCase();
    
    var stream = through();
    var meta = { size: 0, headerSize: 0 };
    
    stream.pipe(through(function (buf, enc, next) {
        meta.size += buf.length;
        next();
    }));
    
    stream.pipe(headers({ maxSize: 4096 }, function (err, fields, m) {
        if (err) stream.emit('error', err);
        meta.fields = fields;
        meta.headerSize = m.size;
    }));
    
    var h = stream.pipe(this.store.addStream());
    h.on('end', function () {
        var now = Date.now();
        rcpts.forEach(function (toFull) {
            var to = toFull.split('@')[0];
            batch(self.db, [
                { type: 'create', key: [ 'email', to, h.hash ], value: meta },
                { type: 'put', key: [ 'from', to, from, h.hash ], value: 0 },
                { type: 'put', key: [ 'exists', to, now, h.hash ], value: 0 },
                { type: 'put', key: [ 'recent', to, now, h.hash ], value: 0 },
                { type: 'put', key: [ 'unseen', to, now, h.hash ], value: 0 },
            ], function (err) { if (err) stream.emit('error', err) });
        });
    });
    return stream;
};

Mail.prototype.fetch = function (box, seqset, field) {
    var self = this;
    var parts = String(seqset).split(':');
    if (parts.length === 1) parts = [ parts[0], parts[0] ];
    var start = Number(parts[0]), end = Number(parts[1]);
    
    var opts = {
        gt: [ 'exists', box, null ],
        lt: [ 'exists', box, undefined ]
    };
    var stream = self.db.createReadStream(opts);
    
    var n = 0, pending = 1;
    var output = stream.pipe(through.obj(write, check));
    return output;
    
    function write (row, enc, next) {
        n ++;
        var seq = n;
        if (n >= start) {
            var key = [ box, row.key[3] ];
            self._getField(key, field, function (err, res) {
                if (err) return output.emit('error', err);
                output.push({ key: seq, value: res });
                check();
            });
        }
        else if (n > end) {
            if (stream.destroy) stream.destroy();
            check();
        }
        else next();
    }
    function check () {
        if (-- pending === 0) output.push(null);
    }
};

Mail.prototype._getField = function (key, rfield, cb) {
    var self = this;
    var field = normalizeField(rfield);
    
    this.db.get([ 'email' ].concat(key), function (err, meta) {
        if (err) return cb(err);
        
        if (field === 'RFC822.SIZE') {
            cb(null, meta.size);
        }
        else if (field === 'RFC822.HEADER') {
            var stream = self.store.getStream(key[1])
                .pipe(split())
                .pipe(through(function (buf, enc, next) {
                    var line = buf.toString('utf8').replace(/\r$/,'');
                    if (line === '') {
                        this.push(null);
                    }
                    else {
                        this.push(line + '\n');
                        next();
                    }
                }))
            ;
            stream.size = meta.headerSize;
            cb(null, stream);
        }
        else if (field === 'RFC822.TEXT.PEEK' || field === 'RFC822.TEXT') {
            // read without setting the seen flag
            var inHeader = true;
            var stream = self.store.getStream(key[1]);
            var h = stream.pipe(headers());
            h.on('body', function (body) {
                body.size = meta.size - meta.headerSize;
                cb(null, body);
            });
            h.on('error', cb);
            stream.on('error', cb);
        }
        else if (field === 'RFC822.TEXT') {
            // read while setting the seen flag
            
        }
        else cb(null, undefined);
    });
};

Mail.prototype.info = function (box, cb) {
    var info = {
        counts: { exists: 0, recent: 0, unseen: 0 },
        head: { unseen: null, exists: null, recent: null }
    };
    var pending = 3;
    function done () { if (-- pending === 0) cb(null, info) }
    
    var estream = this.db.createReadStream({
        gt: [ 'exists', box, null ],
        lt: [ 'exists', box, undefined ]
    });
    var ustream = this.db.createReadStream({
        gt: [ 'unseen', box, null ],
        lt: [ 'unseen', box, undefined ]
    });
    var rstream = this.db.createReadStream({
        gt: [ 'recent', box, null ],
        lt: [ 'recent', box, undefined ]
    });
    
    function onerror (err) { cb(err); cb = function () {} }
    estream.on('error', onerror);
    rstream.on('error', onerror);
    ustream.on('error', onerror);
    
    estream.pipe(through.obj(function (row, enc, next) {
        if (!info.head.exists) info.head.exists = row.key[3];
        info.counts.exists ++;
        next();
    }, done));
    ustream.pipe(through.obj(function (row, enc, next) {
        if (!info.head.unseen) info.head.unseen = row.key[3];
        info.counts.unseen ++;
        next();
    }, done));
    rstream.pipe(through.obj(function (row, enc, next) {
        if (!info.head.recent) info.head.recent = row.key[3];
        info.counts.recent ++;
        next();
    }, done));
};

Mail.prototype.search = function (box, query, cb) {
    var self = this;
    var stream = self.db.createReadStream({
        gt: [ 'exists', box, null ],
        lt: [ 'exists', box, undefined ]
    });
    var seq = 0, pending = 1;
    
    var results = stream.pipe(through.obj(function (row, enc, next) {
        var rseq = ++ seq;
        pending ++;
        self._match(query, row, function (err, matching) {
            if (matching) {
                var hash = row.key[3];
                results.push({ seq: seq, key: hash });
            }
            check();
        });
        next();
    }, check));
    
    function check () { if (-- pending === 0) results.push(null) }
    
    if (cb) {
        results.pipe(collect(cb));
        results.once('error', cb);
    }
    stream.once('error', function (err) { results.emit('error', err) });
    return results;
};

Mail.prototype._match = function (query, row, cb) {
    process.nextTick(function () { cb(null, true) }); // for now;
};

function collect (cb) {
    var rows = [];
    return through.obj(write, end);
    function write (row, enc, next) { rows.push(row); next() }
    function end () { cb(null, rows) }
}

function normalizeField (key) {
    if (/^BODY\b/i.test(key)) key = key.replace(/^BODY/i, 'RFC822');
    return key.toUpperCase();
}
