// ==UserScript==
// @name         LongURL Mobile Expander
// @description  Expand shortened URLs wherever you go by harnessing the power of LongURL.org.
// @version      2.1
// @author       Sean Murphy
// @namespace    http://IamSeanMurphy.com
// @copyright    2008-2012, Sean Murphy
// @license      GNU GPL (http://www.gnu.org/copyleft/gpl.html)
// @include      http://*
// @include      https://*
// @require      http://cdnjs.cloudflare.com/ajax/libs/underscore.js/1.4.1/underscore-min.js
// @require      http://cdnjs.cloudflare.com/ajax/libs/jquery/1.8.2/jquery.min.js
// ==/UserScript==

/**
 * LongURL Mobile Expander class
 */
function LongURLMobileExpander() {
	/**
	 * @access private
	 */
	var self = this,
		cache = [],
		queue = [],
		tooltip,
		tooltipTimeout,
		currentElement;
	
	/**
	 * @access public
	 */
	this.apiEndpoint = 'http://api.longurl.org/v2/';
	this.scriptVersion = '2.1';

	/**
	 * Initialization method
	 *
	 * @access privileged
	 * @return void
	 */
	this.init = function() {
		// Create the tooltip element
		tooltip = $('<span></span>')
			.css({
				display: 'none',
				position: 'absolute',
				overflow: 'hidden',
				maxWidth: '300px',
				backgroundColor: '#ffffc9',
				border: '1px solid #c9c9c9',
				padding: '3px',
				fontSize: '0.6em',
				fontFamily: 'Helvetica, Arial, sans-serif',
				letterSpacing: '0px',
				color: '#000',
				zIndex: '5000',
				textAlign: 'left'
			})
			.hover(function() {
				clearTimeout(tooltipTimeout);
			}, this.hideTooltip);
		
		// Inject the tooltip into the document
		$('body').append(tooltip);
		
		// Bind event handlers to short URLs
		modifyShortLinks(getServices(modifyShortLinks));

		// Process new links added by Ajax/JS
		$('body').bind(
			'DOMNodeInserted', 
			_.debounce(function() {
				console.log('node inserted');
				modifyShortLinks(getServices());
			}, 
			200
		));
	};
	
	/**
	 * Set tooltip content and position
	 *
	 * @access privileged
	 * @param str text
	 * @param int x (optional)
	 * @param int y (optional)
	 * @return void
	 */
	this.setTooltip = function(text, x, y) {
		tooltip
			.html(text || 'Expanding...')
			.css({
				display: 'inline',
				top: (y + 15 || tooltip.css('top')) + 'px',
				left: (x || tooltip.css('left')) + 'px'
			});
	};
	
	/**
	 * Hide tooltip after a delay
	 *
	 * @access privileged
	 * @return void
	 */
	this.hideTooltip = function() {
		clearTimeout(tooltipTimeout);
		tooltipTimeout = setTimeout(function() {
			tooltip.hide();
		}, 600);
	}
	
	/**
	 * Expand a link and set the tooltip for that link to the expanded URL
	 *
	 * @access privileged
	 * @param str url
	 * @return void
	 */
	this.expandLink = function(url) {
		if (_.isUndefined(url)) return;
		
		// Check cache
		if (getCache(url) !== false) return getCache(url);
		
		// An API request has already been sent for this URL
		if (!enqueue(url)) return;
		
		ajax({
			method: 'GET',
			url: this.apiEndpoint + 'expand?format=json&title=1&url=' + encodeURIComponent(url),
			headers: {
				'User-Agent': 'LongURL Mobile Expander/' + this.scriptVersion + ' (Greasemonkey)'
			},
			onload: function(response) {
				data = $.parseJSON(response.responseText);
				
				// cache response
				if (!_.isUndefined(data.messages)) { // There was an error
					var result = 'LongURL Error: ' + data.messages[0].message;
				} else {
					var result = data['long-url'];
					if (!_.isUndefined(data['title'])) {
						result = '<strong style="font-weight: bold;">'+data['title']+'</strong><br />' + result;
					}
					result += ' <a href="http://longurl.org/expand?url=' 
						+ encodeURIComponent(url) 
						+ '&amp;src=lme_gm" title="Get more information about this link" style="color:#00f;">[more]</a>';
				}
				
				setCache(url, result);
				
				//Remove from queue
				dequeue(url);
				
				// Make sure user is still hovering over this link before updating tooltip
				if (current() === url) {
					self.setTooltip(getCache(url));
				}
			}
		});
	};
	
	/**
	 * Get the list of supported URL shortening services
	 *
	 * @access private
	 * @param Function callback (optional) Function to call when the Ajax response comes back
	 * @return Object|void
	 */
	var getServices = function(callback) {
		// Get from cache
		if (getCache('services')) return getCache('services');
		
		// Get from storage
		if (Date.parse(getValue('longurl_services_expire', 0)) > (new Date).getTime()) {
			var serializedServices = getValue('longurl_services', false),
			 	services = $.parseJSON(serializedServices);
			
			setCache('services', services);
			return services;
		}
		
		// Get from API
		ajax({
			method: 'GET',
			url: self.apiEndpoint + 'services?format=json',
			headers: {
				'User-Agent': 'LongURL Mobile Expander/' + self.scriptVersion + ' (Greasemonkey)'
			},
			onload: function(response) {
				data = $.parseJSON(response.responseText);
				
				if (_.isArray(data.messages)) {
					return; // There was an error
				}
				
				setCache('services', data);
				saveServices(data);
				
				if (_.isFunction(callback)) {
					callback(data);
				}
			}
		});
	};
	
	/**
	 * Save list of supported URL shortening services so they are cached between pages/requests
	 *
	 * @access private
	 * @param Object services
	 * @return void
	 */
	var saveServices = function(services) {
		// Store the list of supported services locally
		if (setValue('longurl_services', JSON.stringify(services))) {
			alert('LongURL Mobile Expander requires Greasemokey 0.3 or higher.');
		}
		
		// Cache for 24 hours
		var date = new Date();
		date.setTime(date.getTime() + (1000 * 60 * 60 * 24 * 1));
		setValue('longurl_services_expire', date.toUTCString());
	};
	
	/**
	 * Find all shortened URLs in the document and attach event handlers
	 *
	 * @access private
	 * @param Object services
	 * @return void
	 */
	var modifyShortLinks = function(services) {
		if (!_.size(services)) return;
		
		var currentDomain = document.location.href.match(/^https?:\/\/(?:www\.)?([^\.]+\.[^\/]+)/i);
		
		// Find all links that haven't been processed yet
		$('a[href]:not(a[data-lme=processed])').each(function(index, a) {
			var $a = $(a),
				domain = $a.attr('href')
						   .match(/^http:\/\/(?:(?:www\.)?(?:[^\.]+\.(notlong\.com|qlnk\.net|ni\.to|lu\.to|zzang\.kr)|([^\.]+\.[^\/]+)))/i);
			
			domain = domain[1] || domain[2] || false;
			
			if ((
					// Isn't a local link AND is in list of short URL services
					domain !== currentDomain[1] 
					&& !_.isUndefined(services[domain])
				) && (
					// Doesn't have a regex OR regex matches
					!services[domain]['regex'] 
					|| $a.attr('href').match(new RegExp(services[domain]['regex'], 'i'))
				))
			{
				// Remove existing tooltip, if present, and attach event handlers
				$a.attr('title', null)
					.hoverIntent(function(e) {
						clearTimeout(tooltipTimeout);
						current(e.target.href);
						self.setTooltip(self.expandLink(e.target.href), e.pageX, e.pageY);
					}, self.hideTooltip);
			}
			
			$a.attr('data-lme', 'processed');
		});
	};

	/**
	 * Set/get the current link element that is being hovered over
	 *
	 * @access private
	 * @param Object element
	 * @return Object|void
	 */
	var current = function(element) {
		if (_.isUndefined(element)) {
			return currentElement;
		}
		currentElement = element;
	};
	
	/**
	 * Cache a value
	 *
	 * @access private
	 * @param str key
	 * @param mixed value
	 * @return void
	 */
	var setCache = function(key, value) {
		cache[escape(key)] = value;
	};
	
	/**
	 * Return a cached value
	 *
	 * @access private
	 * @param str key
	 * @return mixed
	 */
	var getCache = function(key) {
		if (!_.isUndefined(cache[escape(key)])) {
			return cache[escape(key)];
		}
		return false;
	};
	
	/**
	 * Add an item to the queue of pending Ajax requests
	 *
	 * @access private
	 * @param str key The short URL
	 * @return bool Based on if the item was already in the queue or not
	 */
	var enqueue = function(key) {
		if (_.isUndefined(queue[escape(key)])) {
			queue[escape(key)] = true;
			return true;
		}
		return false;
	};
	
	/**
	 * Remove an item from the queue of pending Ajax requests
	 *
	 * @access private
	 * @param str key The short URL
	 * @return void
	 */
	var dequeue = function(key) {
		queue.splice(queue.indexOf(escape(key)), 1);
	};

	/**
	 * Store a value locally so that it survives the current pageview
	 *
	 * Greasekit did away with the GM_* functions, so for compatability I have to use wrapper functions and implement alternative
	 * functionality.
	 *
	 * @access private
	 * @param str key
	 * @param mixed value
	 * @return bool|void
	 */
	var setValue = function(key, value) {
		if (_.isFunction(GM_setValue)) {
			return GM_setValue(key, value);
		} else {	
			document.cookie = key + '=' + encodeURIComponent(value);
		}
	};

	/**
	 * Get a value that was stored locally
	 *
	 * @access private
	 * @param str key
	 * @param mixed defaultValue
	 * @return mixed
	 */
	var getValue = function(key, defaultValue) {
		if (_.isFunction(GM_getValue)) {
			return GM_getValue(key, defaultValue);
		} else {
			if (document.cookie != '') {
				var cookies = document.cookie.split(';');

				for(var x = 0; x < cookies.length; x++) {
					var cookie = new String(cookies[x]).strip();

					if (cookie.substring(0, key.length + 1) === (key + '=')) {
						return decodeURIComponent(cookie.substring(key.length + 1));
					}
				}
			}
			return defaultValue;
		}
	};
	
	/**
	 * Make an Ajax request
	 *
	 * @access private
	 * @param Object options
	 * @return Object|void
	 */
	var ajax = function(options) {
		if (_.isFunction(GM_xmlhttpRequest)) {
			return GM_xmlhttpRequest(options);
		} else {
			// This probably doesn't work
			json_callback = details.onload;
		    var script = document.createElement('script');
		    script.src = details.url + '&callback=json_callback';
		    document.body.appendChild(script);
		}
	};
}

$(function() {
	lme = new LongURLMobileExpander();
	lme.init();
});

/**
* hoverIntent r6 // 2011.02.26 // jQuery 1.5.1+
* <http://cherne.net/brian/resources/jquery.hoverIntent.html>
* 
* @param  f  onMouseOver function || An object with configuration options
* @param  g  onMouseOut function  || Nothing (use configuration options object)
* @author    Brian Cherne brian(at)cherne(dot)net
*/
(function($){$.fn.hoverIntent=function(f,g){var cfg={sensitivity:7,interval:100,timeout:0};cfg=$.extend(cfg,g?{over:f,out:g}:f);var cX,cY,pX,pY;var track=function(ev){cX=ev.pageX;cY=ev.pageY};var compare=function(ev,ob){ob.hoverIntent_t=clearTimeout(ob.hoverIntent_t);if((Math.abs(pX-cX)+Math.abs(pY-cY))<cfg.sensitivity){$(ob).unbind("mousemove",track);ob.hoverIntent_s=1;return cfg.over.apply(ob,[ev])}else{pX=cX;pY=cY;ob.hoverIntent_t=setTimeout(function(){compare(ev,ob)},cfg.interval)}};var delay=function(ev,ob){ob.hoverIntent_t=clearTimeout(ob.hoverIntent_t);ob.hoverIntent_s=0;return cfg.out.apply(ob,[ev])};var handleHover=function(e){var ev=jQuery.extend({},e);var ob=this;if(ob.hoverIntent_t){ob.hoverIntent_t=clearTimeout(ob.hoverIntent_t)}if(e.type=="mouseenter"){pX=ev.pageX;pY=ev.pageY;$(ob).bind("mousemove",track);if(ob.hoverIntent_s!=1){ob.hoverIntent_t=setTimeout(function(){compare(ev,ob)},cfg.interval)}}else{$(ob).unbind("mousemove",track);if(ob.hoverIntent_s==1){ob.hoverIntent_t=setTimeout(function(){delay(ev,ob)},cfg.timeout)}}};return this.bind('mouseenter',handleHover).bind('mouseleave',handleHover)}})(jQuery);