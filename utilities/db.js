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
			this.bot = bot;
			this.connected = false;
			bf.db.instances.push(this);
			this.channelCompletion = new Map();
			this.channelRequests = new Map();
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
					if (message.id && this.messageCache.has(message.id)) {
						message = this.messageCache.get(message.id);
						console.log(`Uncaching ${message.id}: ${message.content}`);
						this.uncacheMessage(message);
					}
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
					let result = this.guild.channels.find(c => c.type == 0 && c.name == channel);
					if (result) return result;
					throw new Error("Channel name couldn't be resolved: "+channel);
				} else {
					let result = this.guild.channels.get(channel);
					if (result) return result;
					throw new Error("Channel ID couldn't be resolved: "+channel);
				}
			}
			throw new Error("Invalid data for channel: "+channel);
		}

		filterReturn(dsm, options) {
			if (options.return) {
				if (typeof(options.return) == "string") {
					dsm = dsm.map(arr => arr[options.return]);
				} else {
					dsm = dsm.map(arr => options.return.map(op => arr[op]));
				}
			}
			return dsm;
		}

		/**
		 * Get a bunch of messages matching input criteria. Searches the internal storage first, but requests more if needed.
		 * @returns {Promise<Discord.Message[]>}
		 */
		async getMessages(channel, options = {}) {
			if (options.single) options.limit = 1;
			if (options.ignoreBadFiterIndexes == undefined) options.ignoreBadFiterIndexes = true;
			let channelObject = this.resolveChannel(channel);
			let messages = this.messageCache.filter(m => m.channel.id == channelObject.id);
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
							let nameFragments = split[0].split(".");
							filter = {
								index: nameFragments.slice(-1)[0],
								table: nameFragments.length > 1 ? nameFragments[0] : undefined,
								value: split[2],
								comparison: split[1]
							}
						}
						// Quit if table doesn't match
						if (filter.table !== undefined && filter.table != channelObject.name) return true;
						// Quit if index doesn't exist
						let rowValue = item[filter.index];
						if (rowValue === undefined) return options.ignoreBadFiterIndexes;
						let filterValue = filter.value;
						if (filter.transform) rowValue = filter.transform(rowValue);
						// Check for number comparison
						if (filter.comparison.startsWith("#")) {
							filter.comparison = filter.comparison.slice(1);
							rowValue = +rowValue;
							filterValue = +filterValue;
						}
						// Do comparison
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
			if (messages.length >= options.limit || this.channelCompletion.get(channelObject.id) == 0) {
				dsm = this.filterReturn(dsm, options);
				if (options.single) return dsm[0];
				else return dsm.slice(0, options.limit);
			}
			return this.fetchMessages(channel).then(() => this.getMessages(channel, options));
		}

		/**
		 * Send the messages to the internal storage.
		 * @returns {Promise<Boolean>} Have we reached the edge of the channel?
		 */
		fetchMessages(channel, limit = 100) {
			let channelObject = this.resolveChannel(channel);
			// Which point should we fetch from?
			let pointer = this.channelCompletion.get(channelObject.id);
			if (pointer == 0) throw new Error("Trying to fetch more messages from a completed channel?");
			// Is there already a request in progress?
			let existing = this.channelRequests.get(channelObject.id);
			if (existing) return existing;
			// There isn't already a request, so create a new one
			// Yes, assigning the chained .then _is_ intentional!
			let request = channelObject.getMessages(limit, pointer).then(messages => {
				// Request completed, send the results to cache
				this.channelRequests.delete(channelObject.id);
				if (messages.length < limit) this.channelCompletion.set(channelObject.id, 0);
				else this.channelCompletion.set(channelObject.id, messages.slice(-1)[0].id);
				messages = messages.filter(m => !m.pinned); // filter out index messages
				messages.forEach(m => this.cacheMessage(m));
			});
			// Save the request
			this.channelRequests.set(channelObject.id, request);
			return request;
		}

		cacheMessage(message) {
			this.messageCache.add(message, undefined, true);
		}

		uncacheMessage(message) {
			this.messageCache.remove(message);
		}

		filter(channel, options = {}) {
			let channelObject = this.resolveChannel(channel);
			// Normalise limit. Default limit is infinite!
			if (options.limit == undefined || isNaN(+options.limit)) delete options.limit;
			else options.limit = +options.limit;
			// No joins? Super simple!
			if (!options.joins) return this.getMessages(channelObject, options);
			else {
				// Oh god, there's joins.
				let fetchOptions = {filters: options.filters};
				let promises = [];
				// Get messages for first channel
				promises.push(this.getMessages(channelObject, fetchOptions));
				// Set up all join objects
				options.joins.forEach(join => {
					join.target = this.resolveChannel(join.target);
					join.fields.forEach((field, index) => {
						if (field.table == null) {
							if (index == 0) field.table = channelObject;
							else field.table = this.resolveChannel(join.target);
						} else if (typeof(field.table) != "object") {
							field.table = this.resolveChannel(field.table);
						}
					});
				});
				// Get messages for all joined channels
				options.joins.forEach(join => {
					promises.push(this.getMessages(join.target, fetchOptions).then(messages => join.messages = messages));
				});
				return Promise.all(promises).then(arr => {
					// messages = current set of content arrays from joins so far
					let messages = arr[0];
					// Loop over each join
					while (options.joins.length) {
						/**
						 * @type {Object}
						 * @prop {String} direction inner, left, right, outer
						 * @prop {ContentArray[]} messages array of content arrays
						 * @prop {Discord.TextChannel} target
						 * @prop {Object[]} fields
						 * @prop {String} fields.field field name to join on
						 * @prop {Discord.TextChannel} fields.table channel that the field exists in
						 */
						let join = options.joins.shift();
						// Construct a results array, then later use it to overwrite messages
						let result = [];
						if (join.direction == "inner") {
							messages.forEach(message => {
								let leftKeys = Object.keys(message);
								let originKey = join.fields[0].field;
								if (originKey != "*" && !leftKeys.includes(originKey)) {
									throw new Error("Left table key not found while joining: "+originKey+" (valid keys are "+leftKeys.join(", ")+")");
								}
								// Get the list of items from the second table to be joined to the current item from the first table
								let targetKey = join.fields[1].field;
								let joinableItems = join.messages.filter(item => {
									let rightKeys = Object.keys(item);
									if (targetKey != "*" && !rightKeys.includes(targetKey)) {
										throw new Error("Right table key not found while joining: "+targetKey+" (valid keys are "+rightKeys.join(", ")+")");
									}
									return item[targetKey] == message[originKey];
								});
								joinableItems.forEach(toJoin => {
									let newItem = Object.assign([], message);
									Object.entries(toJoin).forEach(entry => {
										if (entry[0].match(/^\d+$/)) entry[0] = +entry[0] + message.length;
										newItem[entry[0]] = entry[1];
									});
									result.push(newItem);
								});
							});
						}
						// Result array is complete, now overwrite messages and go to the next join
						messages = result;
					}
					messages = this.filterReturn(messages, options);
					if (options.single) return messages[0];
					else if (options.limit) return messages.slice(0, options.limit);
					else return messages;
				});
			}
		}

		fetchChannel(channel) {
			return this.fetchMessages(channel, Infinity);
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

		pretty(input, full) {
			return this.query(input).then(rows => {
				if (rows instanceof Array) {
					if (rows[0] && rows[0].length) {
						let rowCount = rows.length;
						if (!full) rows = rows.slice(0, 20);
						return cf.tableify(Array(rows[0].length).fill().map((_, i) => rows.map(r => r[i])))+"\n> Showing "+rows.length+" out of "+rowCount+" rows";
					}
				}
				return rows;
			});
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