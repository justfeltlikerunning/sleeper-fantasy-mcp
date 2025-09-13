import { config, getLeagueConfig } from "../config.js";
import type { SleeperRoster } from "../types/sleeper.js";

export class PlayerNewsTool {
  name = "get_player_news";
  description = "Get player news, injury status, and recent updates for your roster or specific players";
  inputSchema = {
    type: "object",
    properties: {
      league: {
        type: "string",
        description: "League name (ROAD_TO_GLORY or DYNASTY), defaults to configured default",
        enum: ["ROAD_TO_GLORY", "DYNASTY"]
      },
      scope: {
        type: "string",
        description: "Scope of players to check: 'roster' (your team), 'trending' (add/drop activity), or 'all' (league-wide)",
        enum: ["roster", "trending", "all"],
        default: "roster"
      },
      hoursBack: {
        type: "number",
        description: "Hours back to check for news updates (default: 48)",
        minimum: 1,
        maximum: 168,
        default: 48
      },
      includeHealthy: {
        type: "boolean",
        description: "Include healthy players without injury status (default: false)",
        default: false
      },
      playerIds: {
        type: "array",
        description: "Specific player IDs to check (optional)",
        items: {
          type: "string"
        }
      }
    }
  };

  async execute(args: any) {
    const leagueConfig = getLeagueConfig(args.league);
    
    if (!leagueConfig) {
      throw new Error(`League configuration not found for: ${args.league}`);
    }

    const scope = args.scope || 'roster';
    const hoursBack = args.hoursBack || 48;
    const includeHealthy = args.includeHealthy || false;
    const specificPlayerIds = args.playerIds;
    const cutoffTime = Date.now() - (hoursBack * 60 * 60 * 1000);

    try {
      // Fetch required data
      const fetchPromises = [
        fetch(`${config.api.baseUrl}/players/nfl`),
        scope === 'roster' || scope === 'all' ? fetch(`${config.api.baseUrl}/league/${leagueConfig.id}/rosters`) : Promise.resolve(null),
        scope === 'trending' || scope === 'all' ? fetch(`${config.api.baseUrl}/players/nfl/trending/add?lookback_hours=${Math.min(hoursBack, 72)}&limit=50`) : Promise.resolve(null),
        scope === 'trending' || scope === 'all' ? fetch(`${config.api.baseUrl}/players/nfl/trending/drop?lookback_hours=${Math.min(hoursBack, 72)}&limit=50`) : Promise.resolve(null)
      ];

      const responses = await Promise.all(fetchPromises);
      
      if (!responses[0]?.ok) {
        throw new Error('Failed to fetch player data');
      }

      const players = await responses[0].json();
      const rosters: SleeperRoster[] = responses[1] ? await responses[1].json() : [];
      const trendingAdd = responses[2] ? await responses[2].json() : [];
      const trendingDrop = responses[3] ? await responses[3].json() : [];

      // Get relevant player IDs based on scope
      let relevantPlayerIds: Set<string>;
      
      if (specificPlayerIds && specificPlayerIds.length > 0) {
        relevantPlayerIds = new Set(specificPlayerIds);
      } else if (scope === 'roster') {
        // Find user's roster by matching owner username or team name
        const users = await fetch(`${config.api.baseUrl}/league/${leagueConfig.id}/users`).then(r => r.json());
        const myUser = users?.find((user: any) => user.display_name === config.username);
        const myRoster = rosters.find(roster => 
          (myUser && roster.owner_id === myUser.user_id)
        );
        relevantPlayerIds = new Set(myRoster?.players || []);
      } else if (scope === 'trending') {
        const trendingPlayerIds = [
          ...trendingAdd.map((p: any) => p.player_id),
          ...trendingDrop.map((p: any) => p.player_id)
        ];
        relevantPlayerIds = new Set(trendingPlayerIds);
      } else {
        // scope === 'all' - check all players, but limit to fantasy-relevant positions
        relevantPlayerIds = new Set();
      }

      // Process players and filter for news-worthy updates
      const newsUpdates = Object.entries(players)
        .filter(([playerId, player]: [string, any]) => {
          // Skip if not in relevant player set (unless scope is 'all')
          if (scope !== 'all' && !relevantPlayerIds.has(playerId)) return false;
          
          // Skip non-fantasy positions for 'all' scope
          if (scope === 'all' && (!player.fantasy_positions || 
              !player.fantasy_positions.some((pos: string) => ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].includes(pos)))) {
            return false;
          }

          // Check if player has recent news update
          const hasRecentUpdate = player.news_updated && player.news_updated > cutoffTime;
          
          // Check if player has injury/status information
          const hasInjuryInfo = player.injury_status || 
                                player.injury_body_part || 
                                player.practice_participation ||
                                player.status === 'Injured Reserve' ||
                                player.status === 'Out' ||
                                player.status === 'Questionable' ||
                                player.status === 'Doubtful';

          // Include if has recent update OR injury info (unless only wanting healthy players)
          if (!includeHealthy && !hasInjuryInfo && !hasRecentUpdate) return false;
          if (includeHealthy && !hasRecentUpdate && !hasInjuryInfo) return false;

          return true;
        })
        .map(([playerId, player]: [string, any]) => {
          const isTrendingAdd = trendingAdd.some((trend: any) => trend.player_id === playerId);
          const isTrendingDrop = trendingDrop.some((trend: any) => trend.player_id === playerId);
          
          // Calculate time since last update
          let timeSinceUpdate = "No recent updates";
          if (player.news_updated) {
            const hoursSince = Math.floor((Date.now() - player.news_updated) / (1000 * 60 * 60));
            if (hoursSince < 1) {
              timeSinceUpdate = "Less than 1 hour ago";
            } else if (hoursSince < 24) {
              timeSinceUpdate = `${hoursSince} hours ago`;
            } else {
              const daysSince = Math.floor(hoursSince / 24);
              timeSinceUpdate = `${daysSince} day${daysSince > 1 ? 's' : ''} ago`;
            }
          }

          return {
            playerId,
            name: `${player.first_name || ''} ${player.last_name || ''}`.trim(),
            position: player.position,
            team: player.team || 'FA',
            status: player.status || 'Active',
            injuryStatus: player.injury_status || null,
            injuryBodyPart: player.injury_body_part || null,
            injuryStartDate: player.injury_start_date,
            injuryNotes: player.injury_notes || null,
            practiceParticipation: player.practice_participation || null,
            practiceDescription: player.practice_description || null,
            newsUpdated: player.news_updated,
            timeSinceUpdate,
            trending: {
              isAdding: isTrendingAdd,
              isDropping: isTrendingDrop,
              activity: isTrendingAdd ? 'Being added' : isTrendingDrop ? 'Being dropped' : 'Stable'
            },
            fantasyPositions: player.fantasy_positions || []
          };
        })
        .sort((a, b) => {
          // Sort by most recent news first, then by injury severity
          if (a.newsUpdated && b.newsUpdated) {
            return b.newsUpdated - a.newsUpdated;
          }
          if (a.newsUpdated && !b.newsUpdated) return -1;
          if (!a.newsUpdated && b.newsUpdated) return 1;
          
          // Secondary sort by injury severity
          const getSeverity = (status: string | null) => {
            if (!status) return 0;
            if (status === 'Out' || status === 'Injured Reserve') return 5;
            if (status === 'Doubtful') return 4;
            if (status === 'Questionable') return 3;
            if (status === 'Probable') return 2;
            return 1;
          };
          
          return getSeverity(b.injuryStatus) - getSeverity(a.injuryStatus);
        });

      const result = {
        league: args.league || config.defaultLeague,
        scope: scope,
        hoursBack: hoursBack,
        cutoffTime: new Date(cutoffTime).toISOString(),
        totalUpdates: newsUpdates.length,
        filters: {
          includeHealthy: includeHealthy,
          specificPlayers: specificPlayerIds ? specificPlayerIds.length : 0
        },
        updates: newsUpdates,
        summary: {
          withInjuries: newsUpdates.filter(p => p.injuryStatus).length,
          withRecentNews: newsUpdates.filter(p => p.newsUpdated && p.newsUpdated > cutoffTime).length,
          trending: {
            adding: newsUpdates.filter(p => p.trending.isAdding).length,
            dropping: newsUpdates.filter(p => p.trending.isDropping).length
          },
          byStatus: this.getStatusSummary(newsUpdates)
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
      throw new Error(`Failed to get player news: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private getStatusSummary(updates: any[]): Record<string, number> {
    return updates.reduce((summary, player) => {
      const status = player.injuryStatus || player.status || 'Active';
      summary[status] = (summary[status] || 0) + 1;
      return summary;
    }, {});
  }
}