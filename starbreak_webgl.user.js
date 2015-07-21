// ==UserScript==
// @name         starbreak webGL renderer
// @namespace    https://github.com/atomizer/starbreak-webgl
// @version      3.4.2
// @description  gotta go fast
// @author       atomizer
// @match        http://*.starbreak.com/
// @grant        none
// @updateURL https://raw.githubusercontent.com/atomizer/starbreak-webgl/master/starbreak_webgl.user.js
// @downloadURL https://raw.githubusercontent.com/atomizer/starbreak-webgl/master/starbreak_webgl.user.js
// ==/UserScript==

'use strict'

var NAME = 'SB-WebGL 3.4.2'

var PIXI, stage, transform
// storage for persistent Sprite objects
var sprites = []
// storage for Texture clips, grouped by sprite sheets
var caches = {}

var spritecount
var prevTime
var noop = function() {}

// maximum amount of sprites rendered per frame
var SPRITES = 5000

var stats = {
	sheets: 0,
	cached: 0,
	draws: 0,
	frames: 0
}

// storage for single-pixel textures (for rectanlges)
var pixels = {}


// stats
var showStats = true, statsTimer
var out = document.createElement('pre')
out.innerHTML = 'loading SB-WebGL...'
out.setAttribute('style', 'position: fixed; top: 0px; margin: 0; background-color: rgba(0,0,0,0.5); color: white;')
document.body.appendChild(out)

function printStats() {
	clearTimeout(statsTimer)
	stats.draws = stats.draws / stats.frames
	// correcting timer variance
	stats.frames = stats.frames * 1000 / (Date.now() - prevTime)
	prevTime = Date.now()

	var o = NAME
	if (showStats) {
		for (var k in stats) {
			o += ' | ' + Math.round(stats[k]) + ' ' + k
		}
	}
	out.innerHTML = o

	stats.draws = stats.frames = 0
	if (showStats) {
		statsTimer = setTimeout(printStats, 1000)
	}
}

out.addEventListener('click', function() {
	showStats = !showStats
	printStats()
})


function fakeDrawImage(i, sx, sy, sw, sh, dx, dy, dw, dh) {
	var src = i.src
	var tex

	if (!src) {
		// draw on the original canvas
		// CanvasRenderingContext2D.prototype.drawImage.apply(this, arguments)
		// return

		// or draw as another sprite
		tex = new PIXI.Texture(PIXI.Texture.fromCanvas(i))//, new PIXI.Rectangle(sx, sy, sw, sh))
		// have to do this manually because we'll not see this canvas ever again
		delete PIXI.utils.BaseTextureCache[i._pixiId]
	}

	var id = src + '-' + sx + '-' + sy
	if (!tex && caches[src]) {
		tex = caches[src][id]
	}

	// populate cache
	if (!tex) {
		if (!PIXI.utils.TextureCache[src]) {
			// we know that the image is loaded so we can do this directly
			var bt = new PIXI.BaseTexture(i)
			var t = new PIXI.Texture(bt)
			PIXI.Texture.addTextureToCache(t, src)
			console.log('~~~ caching sprite sheet', src)
			stats.sheets++
		}
		var sprtex = new PIXI.Texture(PIXI.utils.TextureCache[src],
			new PIXI.Rectangle(sx, sy, sw, sh))
		stats.cached++

		caches[src] = caches[src] || {}
		caches[src][id] = sprtex
		tex = sprtex
	}

	var spr = sprites[spritecount]
	if (!spr) return

	spr.texture = tex

	// transform
	var wt = spr.worldTransform
	var scalex = dw / sw
	var scaley = dh / sh
	wt.fromArray([scalex, 0, dx, 0, scaley, dy])
	wt.prepend(transform)

	// shading
	var co = this.globalCompositeOperation
	if (co == 'lighter') {
		spr.blendMode = PIXI.BLEND_MODES.ADD // TODO better blending pls
	} else if (co == 'multiply') {
		spr.blendMode = PIXI.BLEND_MODES.MULTIPLY
	} else {
		spr.blendMode = PIXI.BLEND_MODES.NORMAL
	}
	spr.alpha = spr.worldAlpha = this.globalAlpha

	spr.visible = true
	spritecount++
	stats.draws++
}

function fakeSetTransform(a, b, c, d, x, y) {
	// pixi and canvas use different coefficient order
	transform.fromArray([a, b, x, c, d, y])
}


function makePixel(color) {
	var c = document.createElement('canvas')
	c.width = c.height = 1
	var ct = c.getContext('2d')
	ct.fillStyle = color
	ct.fillRect(0, 0, 1, 1)
	return PIXI.Texture.fromCanvas(c)
}


function getColoredTexture(color) {
	if (!pixels[color]) {
		pixels[color] = makePixel(color)
	}
	return pixels[color]
}

function fakeFillRect(x, y, w, h) {
	if (w == 1 && h == 1) { // dots
		CanvasRenderingContext2D.prototype.fillRect.apply(this, arguments)
		return
	}
	var spr = sprites[spritecount]
	spr.texture = getColoredTexture(this.fillStyle)
	spr.worldTransform.fromArray([w, 0, x, 0, h, y])
	spr.alpha = spr.worldAlpha = this.globalAlpha || 1
	spr.visible = true
	spritecount++
}

function fakeStrokeRect(x, y, w, h) {
	var tex = getColoredTexture(this.fillStyle)
	for (var i = 0; i < 4; i++) {
		var spr = sprites[spritecount]
		spr.texture = tex
		spr.worldTransform.fromArray([
			i % 2 ? 1 : w, // width
			0,
			i < 3 ? x : x + w - 1, // X offset
			0,
			i % 2 ? h : 1, // height
			i == 2 ? y + h - 1 : y // Y offset
		])
		spr.alpha = spr.worldAlpha = 1
		spr.visible = true
		spritecount++
	}
}


function patch() {
	if (typeof window.XDL == 'undefined' || !window.XDL.ctx || !window.PIXI) {
		return setTimeout(patch, 1000)
	}

	var originalcontext = window.XDL.ctx
	var originalcanvas = window.Module.canvas
	// inject interceptors
	originalcontext.drawImage = fakeDrawImage
	originalcontext.setTransform = fakeSetTransform
	originalcontext.fillRect = fakeFillRect
	originalcontext.strokeRect = fakeStrokeRect
	originalcontext.lineTo = noop // cant be bothered implementing this

	// initialize pixi renderer
	PIXI = window.PIXI
	var renderer = new PIXI.WebGLRenderer(originalcanvas.width, originalcanvas.height, {
		clearBeforeRender: false
	})
	renderer.plugins.interaction.destroy()
	renderer.plugins.interaction = null
	var cont = document.createElement('div')
	cont.setAttribute('style', 'position: absolute; width: 100%; z-index: -1; text-align: center; line-height: 0;')
	cont.appendChild(renderer.view)
	document.body.insertBefore(cont, originalcanvas.parentElement)

	window.Browser.resizeListeners.push(function(w, h) {
		renderer.resize(w, h)
	})

	stage = new PIXI.Container()

	// prepare sprite stubs
	for (var i = 0; i < SPRITES; i++) {
		var s = new PIXI.Sprite()
		s.updateTransform = noop
		sprites.push(s)
		stage.addChild(s)
	}

	// frame loop hooks
	window.Module.preMainLoop = function myPre() {
		originalcontext.clearRect(0, 0, originalcanvas.width, originalcanvas.height)
		for (var k = 0; k < spritecount; k++) {
			sprites[k].visible = false
		}
		spritecount = 0
	}

	window.Module.postMainLoop = function myPost() {
		renderer.render(stage)
		stats.frames++
	}

	transform = new PIXI.Matrix()

	printStats()

	console.log('~~~~~ patch complete ~~~~~')
}
patch()


// insert pixi
var s = document.createElement('script')
s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pixi.js/3.0.7/pixi.js'
document.body.appendChild(s)

