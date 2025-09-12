import { config, getLeagueConfig } from "../config.js";

export class LineupOptimizerTool {
  name = "optimize_lineup";
  description = "Suggest optimal lineup based on projections";
  inputSchema = {
    type: "object",
    properties: {
      league: {
        type: "string",
        description: "League name (ROAD_TO_GLORY or DYNASTY), defaults to configured default",
        enum: ["ROAD_TO_GLORY", "DYNASTY"]
      },
      week: {
        type: "number",
        description: "Week number (defaults to current week)",
        minimum: 1,
        maximum: 18
      }
    }
  };

  async execute(args: any) {
    const leagueConfig = getLeagueConfig(args.league);
    
    if (!leagueConfig) {
      throw new Error(`League configuration not found for: ${args.league}`);
    }

    const week = args.week || this.getCurrentWeek();
    const season = new Date().getFullYear().toString();

    try {
      // Fetch league settings, roster, and player data
      const [leagueResponse, rostersResponse, usersResponse, playersResponse] = await Promise.all([
        fetch(`${config.api.baseUrl}/league/${leagueConfig.id}`),
        fetch(`${config.api.baseUrl}/league/${leagueConfig.id}/rosters`),
        fetch(`${config.api.baseUrl}/league/${leagueConfig.id}/users`),
        fetch(`${config.api.baseUrl}/players/nfl`)
      ]);

      if (!leagueResponse.ok || !rostersResponse.ok || !usersResponse.ok || !playersResponse.ok) {
        throw new Error('Failed to fetch lineup optimization data');
      }

      const league = await leagueResponse.json();
      const rosters = await rostersResponse.json();
      const users = await usersResponse.json();
      const players = await playersResponse.json();

      const userMap = new Map(users.map((user: any) => [user.user_id, user]));

      // Find user's roster
      const myRoster = rosters.find((roster: any) => {
        const user: any = userMap.get(roster.owner_id);
        return user?.display_name === config.username || 
               user?.username === config.username ||
               user?.display_name === leagueConfig.teamName || 
               user?.username === leagueConfig.teamName;
      });

      if (!myRoster) {
        throw new Error(`Could not find roster for user: ${config.username}`);
      }

      // Get league roster positions (lineup requirements)
      const rosterPositions = league.roster_positions;
      
      // Fetch individual projections for roster players
      const projectionPromises = myRoster.players.map(async (playerId: string) => {
        try {
          const projectionResponse = await fetch(
            `https://api.sleeper.app/projections/nfl/player/${playerId}?season=${season}&season_type=regular&week=${week}`
          );
          if (projectionResponse.ok) {
            const data = await projectionResponse.json();
            return { playerId, projectedPoints: data.stats?.pts_ppr || 0 };
          }
          return { playerId, projectedPoints: 0 };
        } catch (error) {
          console.warn(`Failed to fetch projection for player ${playerId}:`, error);
          return { playerId, projectedPoints: 0 };
        }
      });

      const projectionResults = await Promise.all(projectionPromises);
      const playerProjections = new Map(
        projectionResults.map(r => [r.playerId, r.projectedPoints])
      );

      // Create player pool with projections
      const playerPool = myRoster.players.map((playerId: string) => {
        const player = players[playerId];
        
        if (!player) return null;
        
        const projectedPoints = playerProjections.get(playerId) || 0;

        return {
          playerId,
          name: `${player.first_name} ${player.last_name}`,
          position: player.position,
          team: player.team,
          status: player.status,
          projectedPoints: Number(projectedPoints.toFixed(2)),
          eligiblePositions: player.fantasy_positions || [player.position]
        };
      }).filter(Boolean).filter((p: any) => p.status === 'Active');

      // Sort players by projected points within each position
      const playersByPosition = this.groupPlayersByPosition(playerPool);
      
      // Optimize lineup based on roster positions
      const optimizedLineup = this.optimizeLineup(playersByPosition, rosterPositions);
      const currentStarters = myRoster.starters;
      
      // Calculate current vs optimal projections
      const currentProjection = currentStarters.reduce((sum: number, playerId: string) => {
        return sum + (playerProjections.get(playerId) || 0);
      }, 0);

      const optimalProjection = optimizedLineup.reduce((sum: number, player: any) => 
        sum + player.projectedPoints, 0);

      // Find suggested changes
      const changes = this.findLineupChanges(currentStarters, optimizedLineup, players);

      const result = {
        week,
        season,
        league: args.league || config.defaultLeague,
        
        currentLineup: {
          starters: currentStarters.map((playerId: string) => {
            const player = players[playerId];
            const projectedPoints = playerProjections.get(playerId) || 0;
            return {
              playerId,
              name: player ? `${player.first_name} ${player.last_name}` : 'Unknown',
              position: player?.position || 'UNK',
              team: player?.team || 'UNK',
              projectedPoints: Number(projectedPoints.toFixed(2))
            };
          }),
          totalProjected: currentProjection.toFixed(1)
        },
        
        optimizedLineup: {
          starters: optimizedLineup,
          totalProjected: optimalProjection.toFixed(1)
        },
        
        analysis: {
          projectedImprovement: (optimalProjection - currentProjection).toFixed(1),
          isOptimal: Math.abs(optimalProjection - currentProjection) < 0.1,
          suggestedChanges: changes,
          rosterPositions: rosterPositions
        }
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to optimize lineup: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private groupPlayersByPosition(players: any[]) {
    const grouped: { [key: string]: any[] } = {};
    
    players.forEach(player => {
      player.eligiblePositions.forEach((position: string) => {
        if (!grouped[position]) grouped[position] = [];
        grouped[position].push(player);
      });
    });

    // Sort each position by projected points
    Object.keys(grouped).forEach(position => {
      grouped[position].sort((a, b) => b.projectedPoints - a.projectedPoints);
    });

    return grouped;
  }

  private optimizeLineup(playersByPosition: { [key: string]: any[] }, rosterPositions: string[]) {
    const lineup: any[] = [];
    const usedPlayers = new Set<string>();

    // Fill specific positions first
    rosterPositions.forEach(position => {
      if (position === 'BN') return; // Skip bench slots

      let bestPlayer: any = null;
      
      if (position === 'FLEX') {
        // For FLEX, consider RB, WR, TE
        const flexEligible = ['RB', 'WR', 'TE'];
        flexEligible.forEach(pos => {
          if (playersByPosition[pos]) {
            playersByPosition[pos].forEach(player => {
              if (!usedPlayers.has(player.playerId) && 
                  (!bestPlayer || player.projectedPoints > bestPlayer.projectedPoints)) {
                bestPlayer = player;
              }
            });
          }
        });
      } else if (position === 'SUPER_FLEX') {
        // For SUPER_FLEX, consider all positions
        Object.keys(playersByPosition).forEach(pos => {
          playersByPosition[pos].forEach(player => {
            if (!usedPlayers.has(player.playerId) && 
                (!bestPlayer || player.projectedPoints > bestPlayer.projectedPoints)) {
              bestPlayer = player;
            }
          });
        });
      } else {
        // Regular position
        if (playersByPosition[position]) {
          bestPlayer = playersByPosition[position].find(player => 
            !usedPlayers.has(player.playerId)
          );
        }
      }

      if (bestPlayer) {
        lineup.push({
          ...bestPlayer,
          lineupPosition: position
        });
        usedPlayers.add(bestPlayer.playerId);
      }
    });

    return lineup;
  }

  private findLineupChanges(currentStarters: string[], optimizedLineup: any[], players: any) {
    const changes: any[] = [];
    const optimizedPlayerIds = optimizedLineup.map(p => p.playerId);

    currentStarters.forEach((currentPlayerId, index) => {
      const optimizedPlayerId = optimizedLineup[index]?.playerId;
      
      if (currentPlayerId !== optimizedPlayerId) {
        const currentPlayer = players[currentPlayerId];
        const suggestedPlayer = optimizedLineup[index];
        
        if (suggestedPlayer) {
          changes.push({
            position: index,
            current: {
              playerId: currentPlayerId,
              name: currentPlayer ? `${currentPlayer.first_name} ${currentPlayer.last_name}` : 'Unknown'
            },
            suggested: {
              playerId: suggestedPlayer.playerId,
              name: suggestedPlayer.name,
              projectedPointsGain: (suggestedPlayer.projectedPoints - 
                (currentPlayer ? Object.values(players[currentPlayerId] || {}).reduce((s: number, p: any) => s + (p || 0), 0) : 0)).toFixed(1)
            }
          });
        }
      }
    });

    return changes;
  }

  private getCurrentWeek(): number {
    const now = new Date();
    const seasonStart = new Date('2024-09-05');
    const weeksSinceStart = Math.floor((now.getTime() - seasonStart.getTime()) / (7 * 24 * 60 * 60 * 1000));
    return Math.max(1, Math.min(18, weeksSinceStart + 1));
  }
}