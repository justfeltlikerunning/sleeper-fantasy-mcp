import { config, getLeagueConfig } from "../config.js";

export class HistoricalScoresTool {
  name = "get_historical_scores";
  description = "Get actual historical fantasy points scored by players";
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
        description: "Week number to get historical scores for",
        minimum: 1,
        maximum: 18
      },
      season: {
        type: "string",
        description: "Season year (defaults to current NFL season)",
        pattern: "^[0-9]{4}$"
      },
      players: {
        type: "array",
        description: "Array of player IDs to get historical scores for (optional - gets your roster if not provided)",
        items: {
          type: "string"
        }
      },
      position: {
        type: "string",
        description: "Filter by position (QB, RB, WR, TE, K, DEF)",
        enum: ["QB", "RB", "WR", "TE", "K", "DEF"]
      }
    },
    required: ["week"]
  };

  async execute(args: any) {
    const leagueConfig = getLeagueConfig(args.league);
    
    if (!leagueConfig) {
      throw new Error(`League configuration not found for: ${args.league}`);
    }

    const week = args.week;
    const season = args.season || this.getCurrentNflSeason();

    try {
      let playerIds = args.players;
      
      // If no specific players requested, get user's roster
      if (!playerIds) {
        const [rostersResponse, usersResponse] = await Promise.all([
          fetch(`${config.api.baseUrl}/league/${leagueConfig.id}/rosters`),
          fetch(`${config.api.baseUrl}/league/${leagueConfig.id}/users`)
        ]);

        if (!rostersResponse.ok || !usersResponse.ok) {
          throw new Error('Failed to fetch roster data');
        }

        const rosters = await rostersResponse.json();
        const users = await usersResponse.json();
        
        const userMap = new Map(users.map((user: any) => [user.user_id, user]));
        const myRoster = rosters.find((roster: any) => {
          const user: any = userMap.get(roster.owner_id);
          return user?.display_name === config.username || 
                 user?.username === config.username ||
                 user?.display_name === leagueConfig.teamName || 
                 user?.username === leagueConfig.teamName;
        });

        if (myRoster) {
          playerIds = myRoster.players;
        }
      }

      if (!playerIds || playerIds.length === 0) {
        throw new Error('No players found to get historical scores for');
      }

      // Fetch historical stats for the specified week/season
      const statsResponse = await fetch(`${config.api.baseUrl}/stats/nfl/regular/${season}/${week}`);
      if (!statsResponse.ok) {
        throw new Error(`Failed to fetch stats for week ${week} of ${season} season`);
      }
      const allStats = await statsResponse.json();

      // Fetch player data for player names and info
      const playersResponse = await fetch(`${config.api.baseUrl}/players/nfl`);
      if (!playersResponse.ok) {
        throw new Error('Failed to fetch player data');
      }
      const players = await playersResponse.json();

      // Process player historical scores
      const playerScores = [];
      
      for (const playerId of playerIds) {
        const player = players[playerId];
        if (!player) continue;
        
        // Apply position filter if specified
        if (args.position && player.position !== args.position) {
          continue;
        }

        const playerStats = allStats[playerId] || {};
        
        playerScores.push({
          playerId,
          name: `${player.first_name} ${player.last_name}`,
          position: player.position,
          team: player.team,
          status: player.status,
          week: week,
          season: season,
          actualPoints: {
            ppr: Number((playerStats.pts_ppr || 0).toFixed(2)),
            halfPpr: Number((playerStats.pts_half_ppr || 0).toFixed(2)),
            standard: Number((playerStats.pts_std || 0).toFixed(2))
          },
          detailedStats: {
            // Passing Stats
            passingYards: playerStats.pass_yd || 0,
            passingTDs: playerStats.pass_td || 0,
            passingInterceptions: playerStats.pass_int || 0,
            passingAttempts: playerStats.pass_att || 0,
            passingCompletions: playerStats.pass_cmp || 0,
            completionPercentage: Number((playerStats.cmp_pct || 0).toFixed(1)),
            passerRating: Number((playerStats.pass_rtg || 0).toFixed(1)),
            yardsPerAttempt: Number((playerStats.pass_ypa || 0).toFixed(2)),
            airYards: playerStats.pass_air_yd || 0,
            sacksTaken: playerStats.pass_sack || 0,
            passingFirstDowns: playerStats.pass_fd || 0,
            
            // Rushing Stats  
            rushingYards: playerStats.rush_yd || 0,
            rushingTDs: playerStats.rush_td || 0,
            rushingAttempts: playerStats.rush_att || 0,
            rushingYardsPerAttempt: Number((playerStats.rush_ypa || 0).toFixed(2)),
            rushingYardsAfterContact: playerStats.rush_yac || 0,
            brokenTackles: playerStats.rush_btkl || 0,
            longestRush: playerStats.rush_lng || 0,
            rushingFirstDowns: playerStats.rush_fd || 0,
            
            // Receiving Stats
            receivingYards: playerStats.rec_yd || 0,
            receivingTDs: playerStats.rec_td || 0,
            receptions: playerStats.rec || 0,
            targets: playerStats.rec_tgt || 0,
            receivingAirYards: playerStats.rec_air_yd || 0,
            yardsAfterCatch: playerStats.rec_yac || 0,
            yardsPerReception: Number((playerStats.rec_ypr || 0).toFixed(2)),
            yardsPerTarget: Number((playerStats.rec_ypt || 0).toFixed(2)),
            drops: playerStats.rec_drop || 0,
            longestReception: playerStats.rec_lng || 0,
            receivingFirstDowns: playerStats.rec_fd || 0,
            
            // Kicking Stats
            fieldGoalsMade: playerStats.fgm || 0,
            fieldGoalsAttempted: playerStats.fga || 0,
            fieldGoalPercentage: playerStats.fgm_pct || 0,
            longestFieldGoal: playerStats.fgm_lng || 0,
            extraPointsMade: playerStats.xpm || 0,
            extraPointsAttempted: playerStats.xpa || 0,
            
            // Miscellaneous
            fumbles: playerStats.fum || 0,
            fumblesLost: playerStats.fum_lost || 0,
            penalties: playerStats.penalty || 0,
            penaltyYards: playerStats.penalty_yd || 0
          },
          snapCounts: {
            offensiveSnaps: playerStats.off_snp || 0,
            teamOffensiveSnaps: playerStats.tm_off_snp || 0,
            teamDefensiveSnaps: playerStats.tm_def_snp || 0,
            teamSpecialTeamsSnaps: playerStats.tm_st_snp || 0,
            specialTeamsSnaps: playerStats.st_snp || 0
          },
          efficiencyMetrics: {
            catchRate: playerStats.rec_tgt > 0 ? Number(((playerStats.rec || 0) / playerStats.rec_tgt * 100).toFixed(1)) : 0,
            snapPercentage: playerStats.tm_off_snp > 0 ? Number(((playerStats.off_snp || 0) / playerStats.tm_off_snp * 100).toFixed(1)) : 0,
            touchdownRate: (playerStats.rush_att || 0) + (playerStats.rec_tgt || 0) > 0 ? 
              Number((((playerStats.rush_td || 0) + (playerStats.rec_td || 0)) / ((playerStats.rush_att || 0) + (playerStats.rec_tgt || 0)) * 100).toFixed(1)) : 0,
            redZoneTargets: playerStats.rec_rz_tgt || 0,
            redZoneCarries: playerStats.rush_rz_att || 0
          },
          rankings: {
            ppr: playerStats.pos_rank_ppr || 999,
            halfPpr: playerStats.pos_rank_half_ppr || 999,
            standard: playerStats.pos_rank_std || 999
          }
        });
      }
      
      // Sort by PPR points (highest first)
      playerScores.sort((a: any, b: any) => b.actualPoints.ppr - a.actualPoints.ppr);

      const result = {
        week,
        season,
        league: args.league || config.defaultLeague,
        totalPlayers: playerScores.length,
        historicalScores: playerScores,
        summary: {
          totalPprPoints: playerScores.reduce((sum: number, p: any) => sum + p.actualPoints.ppr, 0),
          averageScore: playerScores.length > 0 ? 
            (playerScores.reduce((sum: number, p: any) => sum + p.actualPoints.ppr, 0) / playerScores.length).toFixed(1) : 0,
          topScorer: playerScores[0] || null,
          playersWhoScored: playerScores.filter((p: any) => p.actualPoints.ppr > 0).length
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
      throw new Error(`Failed to get historical scores: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private getCurrentNflSeason(): string {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1; // getMonth() returns 0-11
    
    // NFL season typically starts in September and runs through February of next year
    // If we're in Jan-July, we're still in the previous year's NFL season
    // If we're in Aug-Dec, we're in the current year's NFL season
    if (currentMonth >= 8) {
      return currentYear.toString();
    } else {
      return (currentYear - 1).toString();
    }
  }
}