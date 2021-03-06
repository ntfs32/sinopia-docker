'use strict';

/**
 * Samman 认证Nodejs实现
 */

var urlencode = require('urlencode')
var Promise = require('promise')
var superagent = require('superagent')
var crypto = require('crypto')
var logger = require('./logging')('samman-auth:Client');
var agent = require('superagent-promise')(superagent, Promise)

function md5 (str) {
  return crypto.createHash('md5').update(str + '').digest('hex')
}

function time () {
  return parseInt(new Date().getTime() / 1000)
}

function microtime (timefloat) {
  var unixtimems = new Date().getTime()
  var sec = parseInt(unixtimems / 1000)
  return timefloat ? (unixtimems / 1000) : (unixtimems - (sec * 1000)) / 1000 + ' ' + sec
}

/**
 * @class SammanClient 认证客户端
 *
 * @param {string} apiUrl API地址
 * @param {string} apiKey 密钥
 * @param {string} remoteUrl 本地url
 */
function SammanClient (apiUrl, apiKey, remoteUrl) {
  /**
   * API地址
   */
  this._apiUrl = apiUrl

  /**
   * API token
   */
  this._apiKey = apiKey

  /**
   * 本地服务器域名
   */
  this._remoteUrl = remoteUrl

  /**
   * 用户列表常量.
   *
   * @type int
   */
  this.USER_LIST = 1
  /**
   * 用户添加常量.
   *
   * @type int
   */
  this.USER_ADD = 2
  /**
   * 用户删除常量.
   *
   * @type int
   */
  this.USER_REMOVE = 3
  /**
   * 用户登陆常量.
   *
   * @type int
   */
  this.USER_LOGIN = 4
}

/**
 * 登录请求方法
 * @param {number} request_type - 请求类型
 * @param {object} args - 请求参数
 * @param {string} service_url - 服务器端记录的client 域名
 * @param {string} method - POST|GET
 */
SammanClient.prototype.send = function (requesttype, args, serviceurl, method) {
  var requestparams = {'samman_action': requesttype, 'samman_args': args}
  var requestJSON = JSON.stringify(requestparams)
  var params =
  'samman_self=' +
  urlencode.encode(this._remoteUrl) +
  '&samman_request=' +
  urlencode.encode(this.generate(requestJSON, this._apiKey, 30, true))
  if (method === 'POST') {
    return agent(method, serviceurl)
      .send(params)
      .set('content-type', 'application/x-www-form-urlencoded')
      .set('cache-control', 'no-cache')
      .set('Content-Length', params.length)
      .end().then(function (data) {
      return data.text
    })
  } else {
    return agent(method, serviceurl).end().then(function (data) {
      return data.text
    })
  }
}

/**
 * ADSAME SAMMAN认证js实现
 * @param {string} str  加密内容
 * @param {string} key  密钥
 * @param {number} expiry  有效期（秒） 默认值 0
 * @param {boolean} operation  加密动作：true ，解密动作：false
 * @return {string}  返回内容
 */
SammanClient.prototype.generate = function (str, key, expiry, operation) {
  operation = expiry || 'DECODE' // 存在有效期则为加密
  operation = operation || 'DECODE'
  key = key || ''
  expiry = expiry || 0
  var keylength = 4
  key = md5(key)

  // 密匙a会参与加解密
  var keya = md5(key.substr(0, 16))
  // 密匙b会用来做数据完整性验证
  var keyb = md5(key.substr(16, 16))
  // 密匙c用于变化生成的密文
  var keyc = keylength ? (operation === 'DECODE' ? str.substr(0, keylength) : md5(microtime()).substr(-keylength)) : ''
  // 参与运算的密匙
  var cryptkey = keya + md5(keya + keyc)

  var strbuf
  if (operation === 'DECODE') {
    str = str.substr(keylength)
    strbuf = new Buffer(str, 'base64')
  } else {
    expiry = expiry ? expiry + time() : 0
    var tmpstr = expiry.toString()
    if (tmpstr.length >= 10) { str = tmpstr.substr(0, 10) + md5(str + keyb).substr(0, 16) + str } else {
      var count = 10 - tmpstr.length
      for (var i = 0; i < count; i++) {
        tmpstr = '0' + tmpstr
      }
      str = tmpstr + md5(str + keyb).substr(0, 16) + str
    }
    strbuf = new Buffer(str)
  }

  var box = new Array(256)
  for (var index = 0; index < 256; index++) {
    box[index] = index
  }
  var rndkey = []
  // 产生密匙簿
  for (var t = 0; t < 256; t++) {
    rndkey[t] = cryptkey.charCodeAt(t % cryptkey.length)
  }
  // 用固定的算法，打乱密匙簿，增加随机性，好像很复杂，实际上对并不会增加密文的强度
  for (var j =0, i1 = 0; i1 < 256; i1++) {
    j = (j + box[i1] + rndkey[i1]) % 256
    var tmps = box[i1]
    box[i1] = box[j]
    box[j] = tmps
  }

  // 核心加解密部分
  for (var a = j = i = 0; i < strbuf.length; i++) {
    a = (a + 1) % 256
    j = (j + box[a]) % 256
    var tmp = box[a]
    box[a] = box[j]
    box[j] = tmp
    // 从密匙簿得出密匙进行异或，再转成字符
    strbuf[i] = strbuf[i] ^ (box[(box[a] + box[j]) % 256])
  }

  var s = ''
  if (operation === 'DECODE') {
    s = strbuf.toString()
    if ((s.substr(0, 10) === 0 || s.substr(0, 10) - time() > 0) && s.substr(10, 16) === md5(s.substr(26) + keyb).substr(0, 16)) {
      s = s.substr(26)
    } else {
      s = ''
    }
  } else {
    s = strbuf.toString('base64')
    var regex = new RegExp('=', 'g')
    s = s.replace(regex, '')
    s = keyc + s
  }

  return s
}

/**
 * 解析SAMMAN请求来的数据
 * @param {string} message - 消息内容
 * @return {Object} 消息内容JSON
 */
SammanClient.prototype.decryptRequest = function (message) {
  message = urlencode.decode(message)
  // 解析请求数据
  var result = {
    action: null,
    params: {}
  }
  var requestJSON = this.generate(message, this._apiKey)
  if (!requestJSON) {
    logger.debug('解密失败，返回空，注意过期时间设置，已经密钥是否ok')
    return result
  }
  var request = JSON.parse(requestJSON)
  switch (request['samman_action']) {
    case 2:
      // 处理添加用户
      result.action = 'add_user'
      result.params.pandaID = request['samman_args']['pandaID']
      result.params.user_name = request['samman_args']['username']
      // result.params.real_name = request ['samman_args'] ['chn_name']
      result.params.email = request['samman_args']['email']
      break
    case 3:
      // 处理删除用户
      result.action = 'del_user'
      result.params.clientUserID = request['samman_args']['clientUserID']
      break
    case 4:
      // 添加管理员
      result.action = 'add_admin'
      result.params.clientUserID = request['samman_args']['clientUserID']
      break
    case 5:
      // 删除管理员
      result.action = 'del_admin'
      result.params.clientUserID = request['samman_args']['clientUserID']
      break
  }
  return result
}

/**
 * 登录请求方法
 * @param {string} username - 用户名
 * @param {string} password - 密码
 * @return {promise} 查询结果 boolean
 */
SammanClient.prototype.login = function (username, password) {
  var params = { username: username, password: password }
  return this.send(this.USER_LOGIN, params, this._apiUrl + '/response', 'POST').then(function (data) {
    if(data== 'true'){
      return {login: true, message: '认证通过'}
    }
    if(data== '未注册的client！'){
      logger.debug('未注册的client！,请检查传入的本地url')
      return {login: false, message: data}
    }
    logger.debug('账号或密码不正确，未授权等原因')
    return {login: false, message:'认证失败'}
  })
}

/**
 * 获取用列表
 * @return {promise} 查询结果
 */
SammanClient.prototype.getlist = function () {
  return this.send(this.USER_LIST, null, this._apiUrl + '/core', 'GET')
}

module.exports = SammanClient