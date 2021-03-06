var request = require('request')
  , Parser = require('./lib/parser')
  , split = require('split')
  , multiparty = require('multiparty')
  , ss = require('stream-stream')
  , api = 'https://www.googleapis.com'

var Gmail = function (key) {
  if (!key) {
    throw new Error('Access key required')
  }
  this.key = key
}

var retrieveCount = function (key, q, endpoint, next) {
  request({
    url: api + '/gmail/v1/users/me/' + endpoint,
    json: true,
    qs: {
      q: q,
      fields: 'resultSizeEstimate'
    },
    headers: {
      'Authorization': 'Bearer ' + key
    }
  }, function (err, response, body) {
    if (err) {
      return next(error)
    }
    if (body.error) {
      return next(new Error(body.error.message))
    }
    return next(null, body.resultSizeEstimate)
  })
}

var retrieve = function (key, q, endpoint, opts) {
  var result = new Parser({objectMode: true})
    , combined = ss()
    , opts = opts || {}

  request({
    url: api + '/gmail/v1/users/me/' + endpoint,
    json: true,
    qs: {
      q: q
    },
    headers: {
      'Authorization': 'Bearer ' + key
    }
  }, function (err, response, body) {
    if (err) {
      return result.emit('error', err)
    }

    if (body.error) {
      return result.emit('error', new Error(body.error.message))
    }

    result.resultSizeEstimate = body.resultSizeEstimate

    if (!result.resultSizeEstimate) {
      return result.end()
    }

    var messages = body[endpoint].map(function (m) {
      return {
        'Content-Type': 'application/http',
        body: 'GET ' + api + '/gmail/v1/users/me/' + endpoint + '/' + m.id + '\n'
      }
    })

    messages.length = opts.max || 100

    var r = request({
      method: 'POST',
      url: api + '/batch',
      multipart: messages,
      headers: {
        'Authorization': 'Bearer ' + key,
        'content-type': 'multipart/mixed'
      }
    })

    r.on('error', function (e) {
      result.emit('error', e)
    })

    r.on('response', function (res) {
      var type = res.headers['content-type']
        , form = new multiparty.Form

      res.headers['content-type'] = type.replace('multipart/mixed', 'multipart/related')

      form.on('part', function (part) {
        combined.write(part.pipe(split('\r\n')).pipe(new Parser))
      }).parse(res)
      form.on('close', function () {
        combined.end()
      })

    })
  })

  return combined.pipe(result)
}

/*
 * Feteches the number of estimated messages matching the query
 * Invokes callback with err and estimated number
 */
Gmail.prototype.estimatedMessages = function (q, next) {
  return retrieveCount(this.key, q, 'messages', next)
}

/*
 * Fetches email that matches the query. Returns a stream of messages with a max of 100 messages
 * since the batch api sets a limit of 100.
 *
 * e.g. to search an inbox: gmail.messages('label:inbox')
 */
Gmail.prototype.messages = function (q, opts) {
  return retrieve(this.key, q, 'messages', opts)
}

/*
 * Feteches the number of estimated threads matching the query
 * Invokes callback with err and estimated number
 */
Gmail.prototype.estimatedThreads = function (q, next) {
  return retrieveCount(this.key, q, 'threads', next)
}

Gmail.prototype.threads = function (q, opts) {
  return retrieve(this.key, q, 'threads', opts)
}

module.exports = Gmail
