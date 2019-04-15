# DBcord

A relational database stored as Discord messages.

## WHY???

Why not?

## How?

Metal and magic.

## I mean, how do I actually use this monstrosity?

The main code is in utilities/db.js. Feel free to copy that over to your own bot project. Along with all the files it depends on. Hurrah.

Or, you can run this whole thing as-is using the following process:

1. `git clone`
2. `npm install`
3. `echo 'module.exports = "blahblahblahtoken.token.supersecret";' > token.js`

You'll want to comment out the line `db.connect("565467535881797647")` in index.js for the moment.

4. `node index.js`
5. `bot.createServer("name", "region")`

Copy the ID from the response and insert it back into the line you commented out earlier. Reinstate that line.

(Or you could just use the ID of a server that you and the bot are already in, but *pssshshhhh.*)

## What functions can I use?

Read the code. I even commented it for you! What a nice person I am!

## What features exist?

### Database features

- add rows
- get rows
- edit rows
- delete rows
- assign names to fields

### API features

- limited sql-like queries

### Other cool stuff

- local cache, only fetch more into cache when needed
- listen for changes by other users and update cache to match

## What features are planned?

- indexing
- joins
- 200% more epic
- I probably forgot something SUPER important so open an issue

## Shoutouts

- [GPLv3® FreeSoftware™](https://en.wikipedia.org/wiki/Freeware)
- [despacito](https://youtu.be/dQw4w9WgXcQ)
- [powercord](https://powercord.dev/)
- [amanda](https://discord-bots.ga/amanda)