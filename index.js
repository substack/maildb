var sublevel = require('level-sublevel/bytewise');
var bytewise = require('bytewise');
var cas = require('content-addressable-store');
var through = require('through2');
var split = require('split');
var headers = require('parse-header-stream');

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

Mail.prototype.save = function () {
    var self = this;
    var stream = through();
    var rows = [];
    var h = stream.pipe(this.store.addStream());
    h.on('end', function () {
        self.db.batch([
            { key: [ 'email', h.hash ], value: fields },
            { key: [ 'from', fields.from, h.hash ], value: 0 },
            { key: [ 'date', Date.now(), h.hash ], value: 0 },
            { key: [ 'recent', h.hash ], value: 0 },
            { key: [ 'unseen', h.hash ], value: 0 },
        ].filter(Boolean));
    });
    stream.pipe(headers(function (err, fields_) {
        if (err) stream.emit('error', err);
        fields = fields_;
    }));
    return stream;
};

Mail.prototype.search = function () {
    var db = this.db;
    var stream = db.createReadStream({
        gt: [ 'date', null ],
        lt: [ 'date', undefined ]
    });
    return stream.pipe(through.obj(function (row, enc, next) {
        var hash = row.key[2];
        this.push(hash);
        next();
    }));
};
