const fs = require('fs')
const path = require('path')
const express = require('express')
const request = require('./util/request')
const packageJSON = require('./package.json')
const exec = require('child_process').exec
const cache = require('./util/apicache').middleware
const { cookieToJson } = require('./util/index')
const fileUpload = require('express-fileupload')
const decode = require('safe-decode-uri-component')

/**
 * The version check result.
 * @readonly
 * @enum {number}
 */
const VERSION_CHECK_RESULT = {
  FAILED: -1,
  NOT_LATEST: 0,
  LATEST: 1,
}

/**
 * @typedef {{
 *   identifier?: string,
 *   route: string,
 *   module: any
 * }} ModuleDefinition
 */

/**
 * @typedef {{
 *   port?: number,
 *   host?: string,
 *   checkVersion?: boolean,
 *   moduleDefs?: ModuleDefinition[]
 * }} NcmApiOptions
 */

/**
 * @typedef {{
 *   status: VERSION_CHECK_RESULT,
 *   ourVersion?: string,
 *   npmVersion?: string,
 * }} VersionCheckResult
 */

/**
 * @typedef {{
 *  server?: import('http').Server,
 * }} ExpressExtension
 */

/**
 * Get the module definitions dynamically.
 *
 * @param {string} modulesPath The path to modules (JS).
 * @param {Record<string, string>} [specificRoute] The specific route of specific modules.
 * @param {boolean} [doRequire] If true, require() the module directly.
 * Otherwise, print out the module path. Default to true.
 * @returns {Promise<ModuleDefinition[]>} The module definitions.
 *
 * @example getModuleDefinitions("./module", {"album_new.js": "/album/create"})
 */
async function getModulesDefinitions(
  modulesPath,
  specificRoute,
  doRequire = true,
) {
  const files = await fs.promises.readdir(modulesPath)
  const parseRoute = (/** @type {string} */ fileName) =>
    specificRoute && fileName in specificRoute
      ? specificRoute[fileName]
      : `/${fileName.replace(/\.js$/i, '').replace(/_/g, '/')}`

  const modules = files
    .reverse()
    .filter((file) => file.endsWith('.js'))
    .map((file) => {
      const identifier = file.split('.').shift()
      const route = parseRoute(file)
      const modulePath = path.join(modulesPath, file)
      const module = doRequire ? require(modulePath) : modulePath

      return { identifier, route, module }
    })

  return modules
}

/**
 * Check if the version of this API is latest.
 *
 * @returns {Promise<VersionCheckResult>} If true, this API is up-to-date;
 * otherwise, this API should be upgraded and you would
 * need to notify users to upgrade it manually.
 */
async function checkVersion() {
  return new Promise((resolve) => {
    exec('npm info NeteaseCloudMusicApi version', (err, stdout) => {
      if (!err) {
        let version = stdout.trim()

        /**
         * @param {VERSION_CHECK_RESULT} status
         */
        const resolveStatus = (status) =>
          resolve({
            status,
            ourVersion: packageJSON.version,
            npmVersion: version,
          })

        resolveStatus(
          packageJSON.version < version
            ? VERSION_CHECK_RESULT.NOT_LATEST
            : VERSION_CHECK_RESULT.LATEST,
        )
      }
    })

    resolve({
      status: VERSION_CHECK_RESULT.FAILED,
    })
  })
}

/**
 * Construct the server of NCM API.
 *
 * @param {ModuleDefinition[]} [moduleDefs] Customized module definitions [advanced]
 * @returns {Promise<import("express").Express>} The server instance.
 */
async function consturctServer(moduleDefs) {
  const app = express()
  const { CORS_ALLOW_ORIGIN } = process.env
  app.set('trust proxy', true)

  /**
   * CORS & Preflight request
   */
  app.use((req, res, next) => {
    if (req.path !== '/' && !req.path.includes('.')) {
      res.set({
        'Access-Control-Allow-Credentials': true,
        'Access-Control-Allow-Origin':
          CORS_ALLOW_ORIGIN || req.headers.origin || '*',
        'Access-Control-Allow-Headers': 'X-Requested-With,Content-Type',
        'Access-Control-Allow-Methods': 'PUT,POST,GET,DELETE,OPTIONS',
        'Content-Type': 'application/json; charset=utf-8',
      })
    }
    req.method === 'OPTIONS' ? res.status(204).end() : next()
  })

  /**
   * Cookie Parser
   */
  app.use((req, _, next) => {
    req.cookies = {'NMTID=00O4k-7SODJSdUmSUaUlP9MSjmYMRUAAAGKjAayAQ; _iuqxldmzr_=32; _ntes_nnid=45990529c2edc0048c6c3e4d37ef3993,1694566354570; _ntes_nuid=45990529c2edc0048c6c3e4d37ef3993; WEVNSM=1.0.0; WNMCID=fvjwsb.1694566356785.01.0; __snaker__id=INud2uYKA4GNbxAt; sDeviceId=YD-%2BrEbSba8%2BUxEVhQUFVaQ3CUsImEIK9ly; P_INFO=lzhin666@163.com|1696668716|0|unireg|00&99|null&null&null#zhj&330300#10#0#0|&0||lzhin666@163.com; YD00000558929251%3AWM_NI=smbWqYXSqCdKmoo6JBxXYUNn1DYtU7YaMANiEUbEH%2BS2WFpkAIzKB%2FJLBlGgW2rwfNoYZUZruGi7gZLMsyJAC8Ga0zMLwzLSArxJejMBOki7AFw1fLCoZ9UOLkdsJrlXdHk%3D; YD00000558929251%3AWM_NIKE=9ca17ae2e6ffcda170e2e6eed4b37de9acb8d6ae33a5bc8fb2d85b978b9eacd873ab9b98b4e545b697fa99f62af0fea7c3b92ab1b3aeb8f4539c8dbfa4e741afb1a1d7c94abc8897b6cd66f39c9795d83d9bbf83a2cd63878baea6cb2191ee99a7f3618397b6acc1258a948e8dc66d95eebe98e546ad8796b6d97ab799a7d8e6529093bd9ac94b81e88982b3728f94b99bcf5983aeb8abe8628f9e818cec3d839ab9d2e54881b196dad84590b5ac94c97ab088aca9ea37e2a3; YD00000558929251%3AWM_TID=nNM8BQVfM0tAAUBEEEaQj3BTDPfvY%2Flg; MUSIC_U=00EDE93BA9BF108529A9C8F973236D8093076CF8948215FE9FDFF37CB3C2381A14C511ABDF6E25DD14A3E260458451B60E989B26B1C7955608B56E43A4EA504A21ABB3061362CCA542AD141DA18E98E7B23D4CC06444D575D11188F828EE9A4B053935E37798F03D3984E1206F99264365EFA671EC50B79827C7072B75966550F8F1363C0362417E4B6539533220A39617373CAA9DE1A3A4381915A12E2FA625E57F9345BF0FFA7C3C02DF2DC8EAC20D5B969B6B9383D7C649FB8094461555AC3A5CFBE7D4A14DABFA6CBA9611E845159C4C7F35CA7271E5A78ED2F02F59F542ECC2234CD8C804716FBCC6E23DB8E490F642F5DEA093306A3A4E55495DE1C2174A46DFD3E2B52B9CE6B40544F3AE82F8C0F02CB4937EF49A6AF32DD4EBD8F5CFB271ADFDAF5C645DB6F136B580ACBA428EE496DD6B42F785518B9C9AA32CBF2F6C11079971C4ED28553198E58614E6BFA02E16F7C401C1DE8D237E878AA55CBD48E2230B18846EC53BD4BC67C610C57702; __remember_me=true; ntes_kaola_ad=1; __csrf=5d2b2e3408f427ea039b6ce2aa467692; __csrf=5d2b2e3408f427ea039b6ce2aa467692; JSESSIONID-WYYY=BoAmm37GjzSR7nT3D%5CWo6SBDcKElSrR63xqrWVnOt7p%2BFjmxgSD%5CS%2BbK4kP2Da%2F0O4iF%5CrUGiCqFe4enBfsYamp8HAvj2P%5CXK31dOQu2Nq0har2P7Gf3HUMVB4Jxhf6%5C9eIESsDk31bwT5I7W86nOd%2B0nyD%5C4WWOeXy%2Fk%5CrHFquFsRXg%3A1703119433708; WM_NI=8E90R62WP3FnQ6%2FpsNLAmy%2FFZuxaq4LRDFFfucGIhykNd%2FLfpBsvNmAnEzcZ%2FlKMJn87L9o0e6iTnAAH4KHUF40edHklWCbJLFddtwdyp75QAGWOcwm1ky30SJ9qh8SvQU0%3D; WM_NIKE=9ca17ae2e6ffcda170e2e6eeacb6658c9ba6a2f548a7b88fa2d14e969f9ab1d533a1899c8bf754abaa9ba9d12af0fea7c3b92afc9bf7d1d13ef289a0d4c56693eae191f246909fa39aae4e9aabb882f440908e8ca7c56eb7bd89aaeb73a992acd0cf6eb49ebd97cd6783b28b9be252edb485aec966fce984daee3ca7eaa7b5ed4b8398fcaccb5f86ec0086e744a9b499a4e142909aac85f77da8a7c0d8b85b839999b0e27dafefa59ab23c9196f792eb3491aa9fb6b337e2a3; WM_TID=h3naGZ8E7dZFBFEURRPR4MGCz5Sz6UHA; ntes_utid=tid._.6LFpN1QYIFdFE0ABRALFpITSj5TiwfyP._.0'}
    //;(req.headers.cookie || '').split(/\s*;\s*/).forEach((pair) => { //  Polynomial regular expression //
    ;(req.headers.cookie || '').split(/;\s+|(?<!\s)\s+$/g).forEach((pair) => {
      let crack = pair.indexOf('=')
      if (crack < 1 || crack == pair.length - 1) return
      req.cookies[decode(pair.slice(0, crack)).trim()] = decode(
        pair.slice(crack + 1),
      ).trim()
    })
    next()
  })

  /**
   * Body Parser and File Upload
   */
  app.use(express.json())
  app.use(express.urlencoded({ extended: false }))

  app.use(fileUpload())

  /**
   * Serving static files
   */
  app.use(express.static(path.join(__dirname, 'public')))

  /**
   * Cache
   */
  app.use(cache('2 minutes', (_, res) => res.statusCode === 200))

  /**
   * Special Routers
   */
  const special = {
    'daily_signin.js': '/daily_signin',
    'fm_trash.js': '/fm_trash',
    'personal_fm.js': '/personal_fm',
  }

  /**
   * Load every modules in this directory
   */
  const moduleDefinitions =
    moduleDefs ||
    (await getModulesDefinitions(path.join(__dirname, 'module'), special))

  for (const moduleDef of moduleDefinitions) {
    // Register the route.
    app.use(moduleDef.route, async (req, res) => {
      ;[req.query, req.body].forEach((item) => {
        if (typeof item.cookie === 'string') {
          item.cookie = cookieToJson(decode(item.cookie))
        }
      })

      let query = Object.assign(
        {},
        { cookie: req.cookies },
        req.query,
        req.body,
        req.files,
      )

      try {
        const moduleResponse = await moduleDef.module(query, (...params) => {
          // 参数注入客户端IP
          const obj = [...params]
          let ip = req.ip

          if (ip.substr(0, 7) == '::ffff:') {
            ip = ip.substr(7)
          }
          // console.log(ip)
          obj[3] = {
            ...obj[3],
            ip,
          }
          return request(...obj)
        })
        console.log('[OK]', decode(req.originalUrl))

        const cookies = moduleResponse.cookie
        if (!query.noCookie) {
          if (Array.isArray(cookies) && cookies.length > 0) {
            if (req.protocol === 'https') {
              // Try to fix CORS SameSite Problem
              res.append(
                'Set-Cookie',
                cookies.map((cookie) => {
                  return cookie + '; SameSite=None; Secure'
                }),
              )
            } else {
              res.append('Set-Cookie', cookies)
            }
          }
        }
        res.status(moduleResponse.status).send(moduleResponse.body)
      } catch (/** @type {*} */ moduleResponse) {
        console.log('[ERR]', decode(req.originalUrl), {
          status: moduleResponse.status,
          body: moduleResponse.body,
        })
        if (!moduleResponse.body) {
          res.status(404).send({
            code: 404,
            data: null,
            msg: 'Not Found',
          })
          return
        }
        if (moduleResponse.body.code == '301')
          moduleResponse.body.msg = '需要登录'
        if (!query.noCookie) {
          res.append('Set-Cookie', moduleResponse.cookie)
        }

        res.status(moduleResponse.status).send(moduleResponse.body)
      }
    })
  }

  return app
}

/**
 * Serve the NCM API.
 * @param {NcmApiOptions} options
 * @returns {Promise<import('express').Express & ExpressExtension>}
 */
async function serveNcmApi(options) {
  const port = Number(options.port || process.env.PORT || '3000')
  const host = options.host || process.env.HOST || ''

  const checkVersionSubmission =
    options.checkVersion &&
    checkVersion().then(({ npmVersion, ourVersion, status }) => {
      if (status == VERSION_CHECK_RESULT.NOT_LATEST) {
        console.log(
          `最新版本: ${npmVersion}, 当前版本: ${ourVersion}, 请及时更新`,
        )
      }
    })
  const constructServerSubmission = consturctServer(options.moduleDefs)

  const [_, app] = await Promise.all([
    checkVersionSubmission,
    constructServerSubmission,
  ])

  /** @type {import('express').Express & ExpressExtension} */
  const appExt = app
  appExt.server = app.listen(port, host, () => {
    console.log(`server running @ http://${host ? host : 'localhost'}:${port}`)
  })

  return appExt
}

module.exports = {
  serveNcmApi,
  getModulesDefinitions,
}
