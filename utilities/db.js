const Discord = require("eris");

/**
 * @param {Object} passthrough
 * @param {Discord.Client} passthrough.bot;
 */
module.exports = function(passthrough) {
	const {bot, cf, bf, reloadEvent} = passthrough;

	/**
	 * @type {import("./parser")}
	 */
	const {Parser, SQLParser} = cf;

	if (!bf.db) bf.db = {};

	bf.db.class = class DBcord {
		constructor() {
			this.connected = false;
			bf.db.instances.push(this);
			this.completedChannels = new Set();
			this.messageCache = new Discord.Collection(Discord.Message);
			/**
			 * @type {Map<String>} <channel ID the names apply to, \{channelID: where the names are stored, fields: \[the names\]\}>
			 */
			this.names = new Map();
			this.namesChannels = new Set();
		}

		connect(guild) {
			/**
			 * @type {Discord.Guild}
			 */
			this.guild = bf.guildObject(guild);
			this.connected = true;

			cf.log("Registering DBcord state events", "spam");
			/**
			 * @param {Discord.Message} message
			 */
			const messageAddCacheListener = message => {
				if (message.guild.id == this.guild.id && message.content) {
					console.log(`Caching ${message.id}: ${message.content}`);
					this.cacheMessage(message);
				}
			}
			bot.on("messageCreate", messageAddCacheListener);
			bot.on("messageUpdate", messageAddCacheListener);
			/**
			 * @param {Discord.Message} message
			 */
			const messageRemoveCacheListener = arr => {
				if (!(arr instanceof Array)) arr = [arr];
				arr.forEach(message => {
					console.log(`Uncaching ${message.id}: ${message.content}`);
					this.uncacheMessage(message);
				});
			}
			bot.on("messageDelete", messageRemoveCacheListener);
			bot.on("messageBulkDelete", messageRemoveCacheListener);

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
			let arr = [message.id].concat(this.deserialiseData(message.content));
			arr.messageID = arr[0];
			let names = this.names.get(message.channel.id);
			if (names) names.fields.forEach((name, index) => arr[name] = arr[index+1]);
			return arr;
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
			if (options.single) options.limit = 1;
			let channelObject = this.resolveChannel(channel);
			let messages = this.messageCache.filter(m => m.channel.id == channelObject.id);
			if (pointer && pointer.id) {
				if (pointer.below) messages = messages.filter(m => m.id <= pointer.id);
				else messages = messages.filter(m => m.id >= pointer.id);
			}
			let dsm = messages.map(m => this.deserialiseMessage(m));
			if (options.filter) options.filters = [options.filter];
			if (options.filters) {
				dsm = dsm.filter(item => {
					return options.filters.every(filter => {
						/*
							index: index of data to compare, 0 is message ID, 1- is rows, or string for named index
							value: value to compare against
							comparison: comparison operator
							?transform: operation to perform on row before comparing
						*/
						if (filter.raw) filter = filter.raw;
						if (typeof(filter) == "string") { // e.g. `name == Cadence`
							let split = filter.split(" ");
							filter = {
								index: split[0],
								value: split[2],
								comparison: split[1]
							}
						}
						let rowValue = item[filter.index];
						let filterValue = filter.value;
						if (filter.transform) rowValue = filter.transform(rowValue);
						if (filter.comparison == "=" || filter.comparison == "==") return rowValue == filterValue;
						else if (filter.comparison == "<") return rowValue < filterValue;
						else if (filter.comparison == ">") return rowValue > filterValue;
						else if (filter.comparison == "<=") return rowValue <= filterValue;
						else if (filter.comparison == ">=") return rowValue >= filterValue;
						else if (filter.comparison == "!=") return rowValue != filterValue;
						else return false;
					});
				});
			}
			if (messages.length >= options.limit || this.completedChannels.has(channel.id)) {
				if (options.return) {
					if (typeof(options.return) == "string") {
						dsm = dsm.map(arr => arr[options.return]);
					} else {
						dsm = dsm.map(arr => options.return.map(op => arr[op]));
					}
				}
				if (options.single) return dsm[0];
				else return dsm.slice(0, options.limit);
			}
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
		fetchMessages(channel, pointer = {}, limit = 100) {
			let channelObject = this.resolveChannel(channel);
			if (!pointer.id) pointer.id = undefined;
			if (pointer.below) var promise = channelObject.getMessages(limit, undefined, pointer.id);
			else var promise = channelObject.getMessages(limit, pointer.id);
			return promise.then(messages => {
				messages.forEach(m => this.cacheMessage(m));
				if (messages.length < limit) this.completedChannels.add(channelObject.id);
			});
		}

		cacheMessage(message) {
			this.messageCache.add(message, undefined, true);
		}

		uncacheMessage(message) {
			this.messageCache.remove(message);
		}

		filter(channel, options = {}) {
			let channelObject = this.resolveChannel(channel);
			if (!options.limit) options.limit = 100;
			return this.getMessages(channelObject, options, options.pointer || undefined);
		}

		fetchChannel(channel) {
			return this.fetchMessages(channel, {}, Infinity);
		}

		async registerNames(channel) {
			let channelObject = this.resolveChannel(channel);
			let messages = await channelObject.getMessages(Infinity);
			messages.forEach(message => {
				let arr = this.deserialiseMessage(message);
				this.names.set(arr[1], {channelID: channelObject.id, fields: arr.slice(2)});
			});
			this.namesChannels.add(channelObject.id);
		}

		get(channel, options = {}) {
			return this.filter(channel, options);
		}

		async update(channel, options, slice, data) {
			let channelObject = this.resolveChannel(channel);
			let items = await this.filter(channel, options);
			items.forEach(item => {
				for (let i = 0; i < slice.length; i++) {
					if (+slice[i]) { // If the slice value is an index...
						item[slice[i]] = data[i];
					} else { // If the slice value is a name...
						let names = this.names.get(channelObject.id);
						if (!names) throw new Error("Trying to update named field, but names not available for channel "+channel);
						let index = names.fields.indexOf(slice[i]);
						if (index == -1) throw new Error("Trying to update named field "+slice[i]+" in channel "+channel+", but field does not exist");
						item[index+1] = data[i];
					}
				}
			});
			return Promise.all(items.map(item => {
				return bot.editMessage(channelObject.id, item[0], this.serialiseData(item.slice(1)))
			})).then(messages => {
				return messages.map(m => {
					return this.deserialiseMessage(m);
				});
			});
		}

		delete(channel, options = {}) {
			let channelObject = this.resolveChannel(channel);
			return this.filter(channel, options).then(messages => {
				return bot.deleteMessages(channelObject.id, messages.map(m => {
					return m.messageID;
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
			if (this.namesChannels.has(message.channel.id)) this.registerNames(message.channel);
			return this.deserialiseMessage(message);
		}

		/**
		 * @param {String} input
		 */
		query(input) {
			let parser = new SQLParser(input);
			let statement = parser.parseStatement();
			if (statement.operation == "select") {
				let options = statement.options;
				if (statement.fields && !statement.fields.includes("*")) {
					if (statement.fields.length == 1) options.return = statement.fields[0];
					else options.return = statement.fields;
				}
				return this.get(statement.table, options);
			} else if (statement.operation == "insert") {
				let channelObject = this.resolveChannel(statement.table);
				if (statement.fields.length == 0) {
					var data = statement.values;
				} else {
					let fields = this.names.get(channelObject.id).fields;
					var data = new Array(fields.length).fill();
					for (let fieldStatIndex = 0; fieldStatIndex < statement.fields.length; fieldStatIndex++) {
						let fieldStorageIndex = fields.indexOf(statement.fields[fieldStatIndex]);
						if (fieldStorageIndex == -1) throw new Error("Trying to insert into named field "+statement.fields[fieldStatIndex]+" in channel "+statement.table+", but field does not exist");
						else data[fieldStorageIndex] = statement.values[fieldStatIndex];
					}
				}
				return this.add(statement.table, data);
			} else if (statement.operation == "update") {
				let fields = [];
				let values = [];
				statement.assignments.forEach(a => {
					fields.push(a.name);
					values.push(a.value);
				});
				return this.update(statement.table, statement.options, fields, values);
			} else if (statement.operation == "delete") {
				return this.delete(statement.table, statement.options);
			} else {
				throw new Error("Unknown query operation: "+statement.operation);
			}
		}

		/**
		 * @param {} channel The channel to add a schema for
		 * @param {String[]} schema The schema to create
		 * @param {?} into The channel to insert the schema into
		 * @returns {Promise}
		 */
		schema(channel, schema, into) {
			let channelObject = this.resolveChannel(channel);
			let existing = this.names.get(channelObject.id);
			if (existing) return this.update(
				existing.channelID,
				{filter: "1 == "+channelObject.id},
				schema.map((_, i) => i+2),
				schema
			);
			if (into) return this.add(into, [channelObject.id].concat(schema));
			throw new Error("Schema does not already exist, and no value for into provided.");
		}
	}

	if (!bf.db.instances) bf.db.instances = [];
	else bf.db.instances.forEach(i => Object.setPrototypeOf(i, bf.db.class.prototype));
}