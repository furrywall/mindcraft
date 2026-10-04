// Validator for "beat_game" tasks: the game is beaten when the credits roll, which happens when the bot walks
// through the exit portal in the end. That portal only opens once the ender dragon is dead.
// Until then the score is how far along the way to the dragon the bot got, so a run that times out still shows its progress.

// in order. reaching a milestone counts all the ones before it as reached too (no need for a pickaxe once you hold 12 eyes)
const MILESTONES = [
    {name: 'stone pickaxe', reached: (s) => s.hasAny(['stone_pickaxe', 'iron_pickaxe', 'diamond_pickaxe', 'netherite_pickaxe'])},
    {name: 'iron pickaxe', reached: (s) => s.hasAny(['iron_pickaxe', 'diamond_pickaxe', 'netherite_pickaxe'])},
    {name: 'entered the nether', reached: (s) => s.dimension === 'the_nether'},
    {name: 'blaze rod', reached: (s) => s.hasAny(['blaze_rod', 'blaze_powder', 'ender_eye'])},
    {name: '12 eyes of ender', reached: (s) => s.count('ender_eye') >= 12},
    {name: 'entered the end', reached: (s) => s.dimension === 'the_end'},
    {name: 'killed the ender dragon', reached: (s) => s.dragonDead()},
    {name: 'credits', reached: (s) => s.credits},
];

export class BeatGameTaskValidator {
    constructor(data, agent) {
        this.data = data;
        this.agent = agent;
        this.progress = 0; // number of milestones reached
        this.credits = false;
        this.listening_to = null;
        this.last_dragon_check = 0;
        this.dragon_dead = false;
    }

    listen(bot) {
        // the server sends this when you go through the exit portal. mineflayer takes care of leaving the credits
        bot._client.on('game_state_change', (packet) => {
            if (packet.reason === 4 || packet.reason === 'win_game')
                this.credits = true;
        });
        this.listening_to = bot;
    }

    dragonDead(bot, dimension) {
        if (this.dragon_dead) return true;
        if (dimension !== 'the_end') return false;
        // searching for blocks is slow, so don't do it on every update
        if (Date.now() - this.last_dragon_check < 5000) return false;
        this.last_dragon_check = Date.now();
        if (Object.values(bot.entities).some(e => e.name === 'ender_dragon')) return false;
        // the bedrock exit portal in the middle of the main island fills with end_portal blocks when the dragon dies
        const end_portal = bot.registry.blocksByName.end_portal;
        this.dragon_dead = !!bot.findBlock({matching: end_portal.id, maxDistance: 64});
        return this.dragon_dead;
    }

    validate() {
        try {
            const bot = this.agent.bot;
            if (this.listening_to !== bot) this.listen(bot);

            const inventory = {};
            for (const slot of bot.inventory.slots) {
                if (slot) inventory[slot.name] = (inventory[slot.name] || 0) + slot.count;
            }
            const dimension = (bot.game.dimension || 'overworld').replace('minecraft:', '');
            const state = {
                dimension,
                credits: this.credits,
                count: (name) => inventory[name] || 0,
                hasAny: (names) => names.some(name => inventory[name] > 0),
                dragonDead: () => this.dragonDead(bot, dimension),
            };

            // go from the last milestone backwards, so the expensive dragon check only runs when it could count
            for (let i = MILESTONES.length - 1; i >= this.progress; i--) {
                if (MILESTONES[i].reached(state)) {
                    this.progress = i + 1;
                    console.log(`Beat the game task: reached milestone '${MILESTONES[i].name}' (${this.progress}/${MILESTONES.length})`);
                    break;
                }
            }

            const valid = this.progress === MILESTONES.length;
            return {
                "valid": valid,
                "score": this.progress / MILESTONES.length,
            };
        } catch (error) {
            console.error('Error validating beat game task:', error);
            return {
                "valid": false,
                "score": this.progress / MILESTONES.length,
            };
        }
    }
}
