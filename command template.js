// require things

module.exports = function(input) {
	let {bot, cf, bf, bc, db} = input;
	let availableFunctions = {
		name: {
			aliases: ["name"],
			shortHelp: "",
			reference: "",
			longHelp: "",
			eris: true,
			code: function(msg, command) {
			}
		}
	}
	return availableFunctions;
}