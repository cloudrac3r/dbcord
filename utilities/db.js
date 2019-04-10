const Discord = require("eris");

/**
 * @param {Object} passthrough
 * @param {Discord.Client} passthrough.bot;
 */
module.exports = function(passthrough) {
	const {bot, cf, bf, reloadEvent} = passthrough;
	
	if (!bf.db) bf.db = {};

	bf.db.class = class DBcord {
		constructor() {
			this.connected = false;
			bf.db.instances.push(this);
			this.completedChannels = new Set();
			this.messageCache = new Discord.Collection(Discord.Message);
		}

		connect(guild) {
			/**
			 * @type {Discord.Guild}
			 */
			this.guild = bf.guildObject(guild);
			this.connected = true;
			return this;
		}

		/**
		 * @param {Array} data
		 * @param {?String} separator
		 * @returns {String}
		 */
		serialiseData(data, separator) {
			/**
			 * @type {String[]}
			 */
			let dataStrings = data.map(d => String(d));
			if (!separator) {
				let serial = dataStrings.join("");
				let first = ";,|:.<>-_+=[]{}";
				separator = [...first].find(char => !serial.includes(char)) || "";
				if (!separator) {
					let range = [0x23, 0x7e];
					let chars = []; // little-endian
					while (serial.includes(Buffer.from(chars))) {
						if (chars[0] == range[1]) {
							let index = 0;
							chars[index]++;
							while (chars[index] == range[1]) {
								chars[index] = range[0];
								index++;
								chars[index]++;
							}
							if (index == chars.length) {
								// Full
								chars.push(range[0]);
							}
						}
					}
					separator = Buffer.from(chars);
				}
			}
			return "!"+separator+"!"+dataStrings.join(separator);
		}
		
		/**
		 * @param {String} data
		 * @returns {String[]}
		 */
		deserialiseData(data) {
			let sepBoundary = data[0];
			let separator = data.split(sepBoundary)[1];
			let result = data.slice(separator.length+2).split(separator);
			return result;
		}

		/**
		 * @param {Discord.Message} message
		 * @returns {String[]}
		 */
		deserialiseMessage(message) {
			return [message.id].concat(this.deserialiseData(message.content));
		}

		/**
		 * @returns {Discord.TextChannel}
		 */
		resolveChannel(channel) {
			if (!channel) throw new Error("No channel provided");
			else if (channel.constructor.name.includes("Channel")) return channel;
			else if (typeof(channel) == "string") {
				if (isNaN(+channel)) {
					channel = this.guild.channels.find(c => c.type == 0 && c.name == channel);
					if (channel) return channel;
					throw new Error("Channel name couldn't be resolved: "+channel);
				} else {
					channel = this.guild.channels.get(channel);
					if (channel) return channel;
					throw new Error("Channel ID couldn't be resolved: "+channel);
				}
			}
			throw new Error("Invalid data for channel: "+channel);
		}

		/**
		 * Get a bunch of messages matching input criteria. Searches the internal storage first, but requests more if needed.
		 * @returns {Promise<Discord.Message[]>}
		 */
		async getMessages(channel, options = {}, pointer = {}) {
			let channelObject = this.resolveChannel(channel);
			let messages = this.messageCache.filter(m => m.channel.id == channelObject.id);
			if (pointer && pointer.id) {
				if (pointer.below) messages = messages.filter(m => m.id <= pointer.id);
				else messages = messages.filter(m => m.id >= pointer.id);
			}
			let dsm = messages.map(m => this.deserialiseMessage(m));
			if (options.filters) {
				dsm = dsm.filter(item => {
					return options.filters.every(filter => {
						/*
						index - index of data to compare, 0 is message ID
						comparison - value to compare against
						type - comparison operator
						*/
						let value = item[filter.index];
						let comparison = filter.comparison;
						if (filter.transform) comparison = filter.transform(comparison);
						if (filter.type == "=" || filter.type == "==") return value == comparison;
						else if (filter.type == "<") return value < comparison;
						else if (filter.type == ">") return value > comparison;
						else if (filter.type == "<=") return value <= comparison;
						else if (filter.type == ">=") return value >= comparison;
						else if (filter.type == "!=") return value != comparison;
						else return false;
					});
				});
			}
			if (messages.length >= options.limit || this.completedChannels.has(channel.id)) return dsm.slice(0, options.limit);
			// Not enough messages in cache, so we need more.
			let fetchPointer = {below: pointer.below, id: 0};
			if (messages.length) {
				messages.forEach(m => {
					if (+m.id > +fetchPointer.id) fetchPointer.id = m.id;
				});
			}
			return this.fetchMessages(channel, fetchPointer).then(() => this.getMessages(channel, options, pointer));
		}

		/**
		 * Send the messages to the internal storage.
		 * @returns {Promise<Boolean>} Have we reached the edge of the channel?
		 */
		fetchMessages(channel, pointer = {}) {
			let channelObject = this.resolveChannel(channel);
			if (!pointer.id) pointer.id = undefined;
			if (pointer.below) var promise = channelObject.getMessages(100, undefined, pointer.id);
			else var promise = channelObject.getMessages(100, pointer.id);
			return promise.then(messages => {
				messages.forEach(m => this.cacheMessage(m));
				if (messages.length < 100) this.completedChannels.add(channelObject.id);
			});
		}

		cacheMessage(message) {
			this.messageCache.add(message, undefined, true);
		}

		filter(channel, options = {}) {
			let channelObject = this.resolveChannel(channel);
			if (!options.limit) options.limit = 100;
			return this.getMessages(channelObject, options, options.pointer || undefined);
		}

		get(channel, options = {}) {
			return this.filter(channel, options);
		}

		async update(channel, options, slice, data) {
			let channelObject = this.resolveChannel(channel);
			let items = await this.filter(channel, options);
			items.forEach(item => {
				for (let i = 0; i < slice.length; i++) {
					item[slice[i]] = data[i];
				}
			});
			return Promise.all(items.map(item => {
				return bot.editMessage(channelObject.id, item[0], this.serialiseData(item.slice(1)))
			})).then(messages => {
				messages.forEach(m => this.messageCache.add(m, undefined, true));
			});
		}


		delete(channel, options = {}) {
			let channelObject = this.resolveChannel(channel);
			return this.filter(channel, options).then(messages => {
				return bot.deleteMessages(channelObject.id, messages.map(m => {
					this.messageCache.delete(m.id);
					return m.id;
				}));
			});
		}

		/**
		 * @param {Array} data
		 */
		async add(channel, data) {
			let channelObject = this.resolveChannel(channel);
			let string = this.serialiseData(data);
			let message = await bf.sendMessage(channelObject, string);
			this.cacheMessage(message);
			return this.deserialiseMessage(message);
		}
	}

	if (!bf.db.instances) bf.db.instances = [];
	else bf.db.instances.forEach(i => Object.setPrototypeOf(i, bf.db.class.prototype));
}