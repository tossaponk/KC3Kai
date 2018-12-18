(function(){
	"use strict";

	KC3StrategyTabs.eventstats = new KC3StrategyTab("eventstats");

	KC3StrategyTabs.eventstats.definition = {
		tabSelf: KC3StrategyTabs.eventstats,
		eventStats: {},
		availableWorlds: [],
		maps: {},
		exportFull: true,

		/* INIT: mandatory
		Prepares initial static data needed.
		---------------------------------*/
		init: function() {
		},

		/* RELOAD: optional
		Loads latest player or game data if needed.
		---------------------------------*/
		reload: function() {
			// TODO codes stub, remove this if nothing to do
		},

		/* EXECUTE: mandatory
		Places data onto the interface from scratch.
		---------------------------------*/
		execute: function() {
			this.maps = localStorage.getObject("maps") || {};
			this.getAvailableWorlds();
			const worldList = this.availableWorlds.map(world => KC3Meta.worldToDesc(world));
			// Then, put worldList into map option

			this.getSimpleStats();
		},

		// Puts avaliable worlds on the menu for selection
		refresh: function () {
		},

		getAvailableWorlds: function() {
			const maps = this.maps;
			for (const key in maps) {
				const mapId = maps[key].id;
				if (mapId) {
					const world = String(mapId).slice(0, -1);
					if (world > 10 && !this.availableWorlds.includes(world)) this.availableWorlds.push(world);
				}
			}
		},

		// Boss reach sorties
		getSimpleStats: function(selectedWorld) {
			let totalSorties = 0;
			let sortieCount = {};
			const maps = this.maps;
			for (const key in maps) {
				const mapId = maps[key].id;
				if (mapId) {
					const world = String(mapId).slice(0, -1);
					const mapNum = String(mapId).slice(-1);
					if (world > 10){
						if (selectedWorld && selectedWorld !== world) {return;}
						const sorties = ((maps[key].stat || {}).onBoss || {}).hpdat || {};
						const count = Object.keys(sorties).length;
						totalSorties += count;
						sortieCount[selectedWorld ? mapNum : key] = count;
					}
				}
			}
			// Then put sortie data onto page
		},

		exportEventStats(selectedWorld) {
			/**
			 * sortieNum: {Object} containing number of sorties needed per map clear, keys are mapnum
			 * 
			 * Below are only used in full export
			 * shipDamages/abyssalDamages: {Object} containing total damage dealt by each ship, keys are shipIds
			 * taihaMagnets: {Object} containing number of times player ship gets taiha before reaching boss, keys are shipIds
			 * shipKills: {Object} containing number of kills made by each ship, keys are shipIds, excludes aerial phase
			 * shipDrops {Object} containing number of drops of each ship, excludes clear rewards, keys are shipIds
			 * bossKill {Object} containing ship ids that cleared the map (not gauge), keys are mapNum
			 */
			const maps = this.maps, sortiePromises = [], rscPromises = [];

			for (const key in maps) {
				const mapId = maps[key].id;
				if (mapId) {
					// Get and check world/map number
					const world = String(mapId).slice(0, -1);
					const mapNum = String(mapId).slice(-1);
					if (selectedWorld != world) continue;
					const sorties = ((maps[key].stat || {}).onBoss || {}).hpdat;
					if (!sorties) continue;

					// Get sortie IDs and clear sortie/event sortie counts
					const totalSorties = Object.keys(sorties).length;
					let counter = 0, firstSortie, clearSortie;
					// Try not to use onClear as it may be undefined if user does not clear on KC3
					const lastSortie = Number(Object.keys(sorties)[totalSorties - 1]), lastGauge = sorties[lastSortie][1];
					for (const sortieID in sorties) {
						const sortie = sorties[sortieID];
						if (counter === 0) firstSortie = Number(sortieID);
						counter++;
						// Here's hoping that multi-gauge don't have same HP amount
						if (sortie[0] === 0 && sortie[1] === lastGauge) {
							clearSortie = Number(sortieID);
							break;
						}
					}
					// Get initial/final resources (may use naveroverall for buckets instead)
					rscPromises.push(this.analyzeResources(firstSortie, clearSortie, lastSortie, mapNum));

					// Full export to scan each sortie between first and last sortie of event map
					if (this.exportFull) {
						sortiePromises.push(this.analyzeBattles(firstSortie, clearSortie, lastSortie, world, mapNum));
					}
				}
			}

			// Export data
			Promise.all(rscPromises).then((rscData) => {
				Promise.all(sortiePromises).then(sortieData => {
					console.debug(sortieData);
					console.debug(rscData);
				});
			});
		},

		analyzeResources: function(firstSortie, clearSortie, lastSortie, mapNum) {
			const rscPromises = [], totalRsc = {};
			rscPromises.push(
				KC3Database.con.sortie.where("id").equals(firstSortie).first(sortie => {
					const firstSortieTime = sortie.time / 3600;
					totalRsc[mapNum + "init"] = {};
					KC3Database.con.resource.where("hour").aboveOrEqual(firstSortieTime).first(rsc => {
						KC3Database.con.useitem.where("hour").aboveOrEqual(firstSortieTime).first(useitem => {
							totalRsc[mapNum + "init"] = [rsc.rsc1, rsc.rsc2, rsc.rsc3, rsc.rsc4, useitem.bucket];
						});
					});
				})
			);
			rscPromises.push(
				KC3Database.con.sortie.where("id").equals(clearSortie || lastSortie).first(sortie => {
					const finalSortieTime = sortie.time / 3600;
					KC3Database.con.resource.where("hour").aboveOrEqual(finalSortieTime).first(rsc => {
						KC3Database.con.useitem.where("hour").aboveOrEqual(finalSortieTime).first(useitem => {
							totalRsc[mapNum + "final"] = [rsc.rsc1, rsc.rsc2, rsc.rsc3, rsc.rsc4, useitem.bucket];
						});
					});
				})
			);
			return Promise.all(rscPromises).then(() => { return totalRsc; });
		},

		analyzeBattles: function (firstSortie, clearSortie, lastSortie, world, mapNum) {
			const hqid = PlayerManager.hq.id, sortieNum = {}, shipDamages = {}, abyssalDamages = {}, taihaMagnets = {}, shipKills = {}, shipDrops = {},
				bossKill = {}, allPromises = [];
			KC3Database.con.sortie.where("id").aboveOrEqual(firstSortie).and(sortie => sortie.id <= lastSortie && sortie.world == world
				&& sortie.mapnum == mapNum && sortie.hq === hqid)
				.each(sortie => {
					if (sortie.id <= (clearSortie || lastSortie)) sortieNum[mapNum] = (sortieNum[mapNum] || 0) + 1;
					sortieNum.total = (sortieNum.total || 0) + 1;
					allPromises.push(KC3Database.con.battle.where("sortie_id").equals(sortie.id).each(battle => {
						// Assign drops
						if (battle.drop > 0) {
							shipDrops[battle.drop] = (shipDrops[battle.drop] || 0) + 1;
						}
						// Init BP and ship id stuff
						const nodeData = sortie.nodes.find(node => node.id === battle.node);
						// Hoping no nodes repeat
						if (nodeData) {
							const nodeKind = nodeData.eventKind;
							const time = nodeKind === 2 ? "night" : (nodeKind === 7 ? "night_to_day" : "day");
							let battleData = time !== "night" ? battle.data : battle.yasen;
							const battleType = {
								player: { 0: "single", 1: "ctf", 2: "stf", 3: "ctf" }[sortie.combined],
								enemy: !battleData.api_ship_ke_combined ? "single" : "combined",
								time: time
							};
							let result = KC3BattlePrediction.analyzeBattle(battleData, [], battleType);
							let battleLog = result.log;
							if (Object.keys(battle.yasen).length > 0 && time === "day") {
								battleType.time = "night";
								result = KC3BattlePrediction.analyzeBattle(battle.yasen, [], battleType);
								battleLog = battleLog.concat(result.log);
							}
							const fleetSent = battleData.api_deck_id;
							let ships = sortie["fleet" + fleetSent];
							let maxHps = battleData.api_f_maxhps, initialHps = battleData.api_f_nowhps;
							if (sortie.combined > 0) {
								ships = ships.concat(new Array(6 - ships.length).fill(0));
								ships = ships.concat(sortie.fleet2);
								maxHps = maxHps.concat(new Array(6 - maxHps.length).fill(0));
								maxHps = maxHps.concat(battleData.api_f_maxhps_combined);
								initialHps = initialHps.concat(new Array(6 - initialHps.length).fill(0));
								initialHps = initialHps.concat(battleData.api_f_nowhps_combined);
							}
							let eships = battleData.api_ship_ke;
							if (battleData.api_ship_ke_combined) {
								eships = eships.concat(battleData.api_ship_ke_combined);
							}
							// Scan battle log and assign damage/kills
							battleLog.forEach(instance => {
								if (instance.attacker) {
									const pos = instance.attacker.position;
									let damage = instance.damage, ship = 0;
									if (Array.isArray(damage)) damage = damage.reduce((a, b) => a + b);
									damage = Math.floor(damage);
									if (instance.attacker.side === "enemy") {
										ship = eships[pos];
										abyssalDamages[ship] = (abyssalDamages[ship] || 0) + damage;
									}
									else if (instance.attacker.side === "player") {
										ship = ships[pos].mst_id;
										shipDamages[ship] = (shipDamages[ship] || 0) + damage;
										if (damage > instance.ehp) {
											shipKills[ship] = (shipKills[ship] || 0) + 1;
											// Get boss kill ship
											if (sortie.id == clearSortie && battle.boss && instance.defender.position == 0) {
												bossKill[mapNum] = ship;
											}
										}
									}
								}
							});
							// Assign taiha magnets
							if (!battle.boss) {
								for (let shipIdx = 0; shipIdx < ships.length; shipIdx++) {
									if (ships[shipIdx] === 0) continue;
									const taihaHp = maxHps[shipIdx] / 4;
									if (initialHps[shipIdx] < taihaHp) continue;
									const resultHp = result.fleets[shipIdx < 6 ? "playerMain" : "playerEscort"][shipIdx < 6 ? shipIdx : shipIdx - 6].hp;
									// No kuso here	
									if (resultHp < taihaHp && resultHp > 0) {
										const ship = ships[shipIdx].mst_id;
										taihaMagnets[ship] = (taihaMagnets[ship] || 0) + 1;
									}
								}
							}
						}
					}));
				});
			return Promise.all(allPromises).then(() => {
				return {
					sortieNum: sortieNum, 
					shipDamages: shipDamages,
					abyssalDamages: abyssalDamages,
					taihaMagnets: taihaMagnets,
					shipKills: shipKills,
					shipDrops: shipDrops,
					bossKill: bossKill,
				};
			});
		},

	};

})();
