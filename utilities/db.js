const Discord = require("eris");

/**
 * @typedef {Object} NameStore
 * @property {String} channelID
 * @property {String[]} fields
 */

/**
 * @typedef {Object} SerialComponents
 * @property {String} prefix
 * @property {String} separator
 * @property {String[]} dataStrings
 */

/**
 * @typedef {Object} IndexFragment
 * @property {Discord.Message} message
 * @property {String[]} contents
 */

void 0;

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

	class DBcord {
		constructor() {
			this.bot = bot;
			this.connected = false;
			bf.db.instances.push(this);
			this.channelCompletion = new Map();
			this.channelRequests = new Map();
			this.messageCache = new Discord.Collection(Discord.Message);
			/**
			 * @type {Map<String, NameStore>} <channel ID the names apply to, \{channelID: where the names are stored, fields: \[the names\]\}>
			 */
			this.names = new Map();
			this.namesChannels = new Set();
			/**
			 * @type {Map<String, IndexStore>} <channel ID the indexes apply to, \{fields: \[\], data: \[...\[\]\]}>
			 */
			this.indexes = new Map();
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
				if (message.guild.id == this.guild.id) {
					if (message.type == 0 && message.content && !message.pinned) {
						let row = this.deserialiseMessage(message);
						if (row) {
							console.log(`Caching ${message.id}: ${message.content}`);
							if (this.indexes.has(message.channel.id)) {
								let index = this.indexes.get(message.channel.id);
								index.remove(row);
								index.add(row);
							}
							this.cacheMessage(message);
						}
					} else if (message.type == 6) {
						message.delete();
					}
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
						if (this.indexes.has(message.channel.id)) {
							let index = this.indexes.get(message.channel.id);
							let row = this.deserialiseMessage(message);
							index.remove(row);
						}
						this.uncacheMessage(message);
					}
				});
			}
			bot.on("messageDelete", messageRemoveCacheListener);
			bot.on("messageDeleteBulk", messageRemoveCacheListener);

			return this;
		}

		/**
		 * @param {Array} data
		 * @returns {String}
		 */
		serialiseData(data) {
			let object = this.serialiseDataComponents(data);
			return object.prefix+object.dataStrings.join(object.separator)
		}

		/**
		 * @param {String[]} data
		 * @returns {SerialComponents}
		 */
		serialiseDataComponents(data) {
			let dataStrings = data.map(d => String(d));
			let serial = dataStrings.join("");
			let first = ";,|:.<>-_+=[]{}";
			let separator = [...first].find(char => !serial.includes(char)) || "";
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
			let prefix = "!"+separator+"!";
			return {prefix, separator, dataStrings};
		}
		
		/**
		 * @param {String} data
		 * @returns {String[]}
		 */
		deserialiseData(data) {
			if (data[0] == data[1]) {
				cf.log("Special message encountered, will not deserialise", "warning");
				return null;
			}
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
		 * @returns {Promise<String[]>}
		 */
		async getMessages(channel, options = {}) {
			if (options.single) options.limit = 1;
			if (options.ignoreBadFiterIndexes == undefined) options.ignoreBadFiterIndexes = true;
			let channelObject = this.resolveChannel(channel);
			let messages = this.messageCache.filter(m => m.channel.id == channelObject.id);
			let dsm = [];
			messages.forEach(m => {
				let de = this.deserialiseMessage(m);
				if (de !== null) dsm.push(de);
			});
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
				messages = messages.filter(m => !m.pinned && m.type == 0); // filter out index messages
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

		/**
		 * @param {} channel
		 * @param {String[]} fields
		 */
		namesToIndexes(channel, fields) {
			let channelObject = this.resolveChannel(channel);
			let names = this.names.get(channelObject.id);
			return fields.map(f => {
				f = String(f);
				if (entry[0].match(/^\d+$/)) return f;
				else {
					if (!names) throw new Error("Trying to resolve names, but names not available for channel "+channel);
					let index = names.fields.indexOf(f);
					if (index == -1) throw new Error("Name "+f+" not found for channel "+channel);
					return index+1;
				}
			});
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

		registerIndex(channel, fields) {
			let channelObject = this.resolveChannel(channel);
			// Already exists? Return it.
			if (this.indexes.has(channelObject.id)) return this.indexes.get(channelObject.id);
			// Doesn't exist? Make a new one.
			let newIndex = new IndexStore(this, channelObject, fields);
			this.indexes.set(channelObject.id, newIndex);
			return newIndex;
		}
	}
	bf.db.class = DBcord;

	class IndexStore {
		/**
		 * @param {DBcord} db 
		 * @param {Discord.TextChannel} channelObject
		 * @param {String[]} fields
		 */
		constructor(db, channelObject, fields) {
			this._indexPrefix = "!!index\n";
			/** Maximum length of data that can be put into a message */
			this.maxLength = 2000 - this._indexPrefix.length;

			this.db = db;
			this.channelObject = channelObject;
			/** Indexes of fields that are indexed, e.g. ["0", "1"] for messageID and first field */
			this.fields = fields;

			/**
			 * Single array of all index contents, for lookup purposes
			 * @type {String[][]}
			 */
			this.contents = [];
			
			/**
			 * Fragments of stored data.
			 * @type {IndexFragment[]}
			 */
			this.fragments = [];

			/** Whether changes are currently being stored */
			this.applying = false;

			/** Whether the queue will be altered next process tick */
			this.willApply = false;
		}

		async setup() {
			// Fetch pin data
			let pins = await this.channelObject.getPins(); // most recent is index 0
			pins.reverse(); // operates in-place
			// Deserialise data
			/** @type {IndexFragment[]} */
			let data = pins.map(message => {
				let content = message.content;
				if (!content.startsWith(this._indexPrefix)) {
					throw new Error("Encountered non-index pinned message with ID "+message.id);
				}
				let contents = this.db.deserialiseData(content.slice(this._indexPrefix.length));
				return {message, contents};
			});
			// Load fields from first pin
			this.fields = data.shift().contents;
			if (!this.fields.includes("0")) throw new Error("Indexed fields of channel "+this.channelObject.name+" does not contain 0");
			// Load fragments from remainaing pins
			this.fragments = data;
			// Organise data
			let linear = [].concat(...this.fragments.map(f => f.contents));
			if (linear.length % this.fields.length != 0) throw new Error("Bad linear length (length = "+linear.length+", fields = "+this.fields.length+")");
			this.contents = [];
			for (let i = 0; i < linear.length; i += this.fields.length) {
				this.contents.push(linear.slice(i, i+this.fields.length));
			}
			// Done
			cf.log("Loaded index for channel "+this.channelObject.name, "info");
			return this;
		}

		async regenerate() {
			// Find out what separator to use
			/** @type {String[][]} */
			let messages = await this.db.get(this.channelObject, {return: this.fields});
			let flat = [].concat(...messages);
			let serial = this.db.serialiseDataComponents(flat);
			// Join into fragments up to maxLength
			let fieldsEntry = this.db.serialiseData(this.fields);
			let fragments = [this._indexPrefix+fieldsEntry];
			let current = "";
			messages.forEach(message => {
				let nextMessage = message.join(serial.separator);
				if (current.length + nextMessage.length + serial.separator.length > this.maxLength) {
					fragments.push(this._indexPrefix + serial.prefix + current);
					current = "";
				}
				if (current.length) nextMessage = serial.separator + nextMessage;
				current += nextMessage;
			});
			fragments.push(this._indexPrefix + serial.prefix + current);
			// Send fragments
			/** @type {Discord.Message[]} */
			let sent = [];
			let previousPinPromise;
			while (fragments.length) {
				let newContents = fragments.shift();
				let newMessage = await Promise.all([bf.sendMessage(this.channelObject, newContents), previousPinPromise]).then(x => x[0]);
				sent.push(newMessage);
				previousPinPromise = newMessage.pin();
			}
			return sent;
		}

		/**
		 * @param {String[]} row
		 *		Data to be added to the index.
		 *		Include all fields, because they will be filtered inside this function.
		 */
		add(row) {
			let toAdd = this.fields.map(field => row[field]);
			this.contents.push(toAdd);
			let fragmentIndex = this.fragments.findIndex(fragment => 
				(this._indexPrefix + this.db.serialiseData(fragment.contents.concat(toAdd))).length <= this.maxLength
			);
			cf.log("Applying index addition to fragment index "+fragmentIndex, "info");
			let fragmentToUse = fragmentIndex != -1 ? this.fragments[fragmentIndex] : {contents: []};
			fragmentToUse.contents = fragmentToUse.contents.concat(toAdd);
			fragmentToUse.modified = true;
			this.fragments[fragmentIndex] = fragmentToUse;
			this.modifyNextTick();
		}

		/**
		 * @param {String[]} row
		 *		Data to be added to the index.
		 *		Include all fields, because they will be filtered inside this function.
		 */
		remove(row) {
			let id = row[0]; // assuming ID is 0 in row (should always be true?)
			this.contents = this.contents.filter(entry => entry[0] != id); // assuming ID is 0 in index's row
			this.fragments.forEach((fragment, fragmentIndex) => {
				let index = 0;
				while (index < fragment.contents.length) {
					if (fragment.contents[index] == id) {
						cf.log("Applying index removal to fragment index "+fragmentIndex+" position "+index, "info");
						fragment.contents.splice(index, this.fields.length);
						fragment.modified = true;
					} else {
						index += this.fields.length;
					}
				}
			});
			this.modifyNextTick();
		}

		modifyNextTick() {
			if (this.willApply) return;
			this.willApply = true;
			if (!this.applying) setImmediate(() => this.apply());
		}

		async apply() {
			this.willApply = false;
			this.applying = true;
			cf.log("Applying index changes...", "info");
			
			let promises = [];
			this.fragments.forEach(fragment => {
				if (fragment.modified) {
					delete fragment.modified;
					promises.push(new Promise(resolve => {
						if (fragment.message) {
							fragment.message.edit(this._indexPrefix+this.db.serialiseData(fragment.contents))
							.then(() => {
								cf.log("Successfully edited message", "info");
								resolve();
							})
							.catch(err => {
								console.error(err);
								throw err;
							});
						} else {
							bf.sendMessage(this.channelObject, this._indexPrefix+this.db.serialiseData(fragment.contents))
							.then(message => {
								cf.log("Successfully sent message", "info");
								fragment.message = message;
								message.pin();
								resolve();
							})
							.catch(err => {
								console.error(err);
								throw err;
							});
						}
					}));
				}
			});
			await Promise.all(promises);

			cf.log("Applied "+promises.length+" changes", "info");
			this.applying = false;
			if (this.willApply) this.apply();
		}
	}

	if (!bf.db.instances) bf.db.instances = [];
	else bf.db.instances.forEach(i => Object.setPrototypeOf(i, bf.db.class.prototype));
}