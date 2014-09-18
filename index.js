var sublevel = require('level-sublevel/bytewise');
var bytewise = require('bytewise');
var cas = require('content-addressable-blob-store');
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
    this.blob = cas(opts.dir || './mail.db');
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
    
    var h = stream.pipe(this.blob.createWriteStream());
    h.on('finish', function () {
        var now = Date.now();
        rcpts.forEach(function (toFull) {
            var to = toFull.split('@')[0];
            batch(self.db, [
                { type: 'create', key: [ 'email', to, h.key ], value: meta },
                { type: 'put', key: [ 'exists', to, now, h.key ], value: 0 },
                { type: 'put', key: [ 'recent', to, now, h.key ], value: 0 },
                { type: 'put', key: [ 'unseen', to, now, h.key ], value: 0 }
            ], function (err) { if (err) stream.emit('error', err) });
        });
    });
    return stream;
};

Mail.prototype.fetch = function (box, seqset, field) {
    var self = this;
    var pending = 1;
    var output = through.obj(write, check);
    return self._range(box, seqset).pipe(output);
    
    function write (row, enc, next) {
        var key = [ box, row.key[3] ];
        pending ++;
        self._getField(key, field, function (err, res) {
            if (err) return output.emit('error', err);
            output.push({ key: row.seq, value: res });
            check();
            next();
        });
    }
    function check () {
        if (--pending === 0) output.push(null);
    }
};

Mail.prototype._range = function (box_, seqset) {
    var self = this;
    var box = box_.split('@')[0];
    var parts = String(seqset).split(':');
    if (parts.length === 1) parts = [ parts[0], parts[0] ];
    var start = Number(parts[0]), end = Number(parts[1]);
    
    var opts = {
        gt: [ 'exists', box, null ],
        lt: [ 'exists', box, undefined ]
    };
    var stream = self.db.createReadStream(opts);
    
    var n = 0;
    return stream.pipe(through.obj(function (row, enc, next) {
        n ++;
        if (n >= start && n <= end) {
            row.seq = n;
            this.push(row);
        }
        if (n > end) {
            if (stream.destroy) stream.destroy();
            this.push(null);
        }
        else next();
    }));
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
            var stream = self.blob.createReadStream({ key: key[1] })
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
            var stream = self.blob.createReadStream({ key: key[1] });
            var h = stream.pipe(headers({ maxSize: 4096 }));
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

Mail.prototype.store = function (box, seqset, type, fields, cb) {
    var self = this;
    var keys = [];
    var ops = [];
    this._range(box, seqset).pipe(through.obj(write, end));
    
    function write (row, enc, next) {
        // A003 STORE 2:4 +FLAGS (\Deleted)
        
        ops.push.apply(ops, fields.map(function (fl) {
            fl = fl.toLowerCase().replace(/^\\/, '');
            
            if (fl === 'deleted') {
                return {
                    type: 'put',
                    key: [ 'deleted', box, row.key ],
                    value: 0
                };
            }
            if (fl === 'seen') {
                return {
                    type: 'del',
                    key: [ 'unseen' ].concat(row.key.slice(1)),
                    value: 0
                };
            }
            if (fl === 'unseen') {
                return {
                    type: 'put',
                    key: [ 'unseen', box, row.key[3] ],
                    value: 0
                };
            }
        }).filter(Boolean));
        
        next();
    }
    function end () {
        self.db.batch(ops, cb)
    }
};

Mail.prototype.expunge = function (box, cb) {
    var self = this;
    var ops = [];
    var stream = self.db.createReadStream({
        gt: [ 'deleted', box, null ],
        lt: [ 'deleted', box, undefined ]
    });
    var expunged = 0;
    stream.on('error', function (err) { cb(err) });
    stream.pipe(through.obj(write, end));
    
    function write (row, enc, next) {
        var to = row.key[2][1];
        var now = row.key[2][2];
        var hkey = row.key[2][3];
        expunged ++;
        
        ops.push.apply(ops, [
            { type: 'del', key: row.key[2] },
            { type: 'del', key: [ 'email', to, hkey ] },
            { type: 'del', key: [ 'exists', to, now, hkey ] },
            { type: 'del', key: [ 'recent', to, now, hkey ] },
            { type: 'del', key: [ 'unseen', to, now, hkey ] }
        ]);
        next();
    }
    
    function end () {
        self.db.batch(ops, function (err) {
            if (err) cb(err)
            else cb(null, expunged)
        });
    }
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
