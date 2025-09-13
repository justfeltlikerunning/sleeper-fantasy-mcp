import { config, getLeagueConfig } from "../config.js";
import type { SleeperRoster } from "../types/sleeper.js";

export class TransactionsTool {
  name = "get_league_transactions";
  description = "Get league transactions including trades, waivers, and free agent moves";
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
        description: "Week number to get transactions for (defaults to current week)",
        minimum: 1,
        maximum: 18
      },
      transactionType: {
        type: "string",
        description: "Filter by transaction type",
        enum: ["trade", "waiver", "free_agent", "all"],
        default: "all"
      },
      limit: {
        type: "number",
        description: "Maximum number of transactions to return (default: 20)",
        minimum: 1,
        maximum: 100,
        default: 20
      },
      includeAllWeeks: {
        type: "boolean",
        description: "Get transactions from all weeks (default: false)",
        default: false
      }
    }
  };

  async execute(args: any) {
    const leagueConfig = getLeagueConfig(args.league);
    
    if (!leagueConfig) {
      throw new Error(`League configuration not found for: ${args.league}`);
    }

    const week = args.week || this.getCurrentWeek();
    const transactionType = args.transactionType || 'all';
    const limit = args.limit || 20;
    const includeAllWeeks = args.includeAllWeeks || false;

    try {
      // Fetch required data
      const fetchPromises = [
        fetch(`${config.api.baseUrl}/league/${leagueConfig.id}/users`),
        fetch(`${config.api.baseUrl}/league/${leagueConfig.id}/rosters`),
        fetch(`${config.api.baseUrl}/players/nfl`)
      ];

      // Add transactions for specific week or all weeks
      if (includeAllWeeks) {
        // Fetch transactions for weeks 1-18
        for (let w = 1; w <= 18; w++) {
          fetchPromises.push(
            fetch(`${config.api.baseUrl}/league/${leagueConfig.id}/transactions/${w}`)
              .catch(() => new Response('[]', { status: 404 })) // Handle weeks that don't exist yet
          );
        }
      } else {
        fetchPromises.push(
          fetch(`${config.api.baseUrl}/league/${leagueConfig.id}/transactions/${week}`)
        );
      }

      const responses = await Promise.all(fetchPromises);
      
      // Check core data responses
      if (!responses[0]?.ok || !responses[1]?.ok || !responses[2]?.ok) {
        throw new Error('Failed to fetch core league data');
      }

      const users = await responses[0].json();
      const rosters: SleeperRoster[] = await responses[1].json();
      const players = await responses[2].json();

      // Process transaction responses
      let allTransactions: any[] = [];
      
      if (includeAllWeeks) {
        // Process all week responses (starting from index 3)
        for (let i = 3; i < responses.length; i++) {
          if (responses[i]?.ok) {
            const weekTransactions = await (responses[i] as Response).json();
            if (Array.isArray(weekTransactions)) {
              allTransactions = allTransactions.concat(
                weekTransactions.map(t => ({ ...t, week: i - 2 })) // Add week number
              );
            }
          }
        }
      } else {
        // Single week response
        if (responses[3]?.ok) {
          const weekTransactions = await responses[3].json();
          if (Array.isArray(weekTransactions)) {
            allTransactions = weekTransactions.map(t => ({ ...t, week }));
          }
        }
      }

      // Create lookup maps
      const userMap = new Map(users.map((user: any) => [user.user_id, user]));
      const rosterMap = new Map(rosters.map(roster => [roster.owner_id, roster]));

      // Filter and format transactions
      const formattedTransactions = allTransactions
        .filter(transaction => {
          if (transactionType === 'all') return true;
          return transaction.type === transactionType;
        })
        .map(transaction => {
          const creator = userMap.get(transaction.creator);
          const creatorRoster = rosterMap.get(transaction.creator);

          // Process adds and drops
          const adds = Object.entries(transaction.adds || {}).map(([playerId, rosterId]) => {
            const player = players[playerId];
            const targetRoster = rosters.find(r => r.roster_id === rosterId);
            const targetUser = targetRoster ? userMap.get(targetRoster.owner_id) : null;
            
            return {
              playerId,
              playerName: player ? `${player.first_name} ${player.last_name}` : 'Unknown Player',
              position: player?.position || 'UNK',
              team: player?.team || 'FA',
              acquiredBy: {
                rosterId,
                teamName: leagueConfig.teamName, // This would need roster metadata for team names
                username: (targetUser as any)?.display_name || 'Unknown'
              }
            };
          });

          const drops = Object.entries(transaction.drops || {}).map(([playerId, rosterId]) => {
            const player = players[playerId];
            const sourceRoster = rosters.find(r => r.roster_id === rosterId);
            const sourceUser = sourceRoster ? userMap.get(sourceRoster.owner_id) : null;
            
            return {
              playerId,
              playerName: player ? `${player.first_name} ${player.last_name}` : 'Unknown Player',
              position: player?.position || 'UNK',
              team: player?.team || 'FA',
              droppedBy: {
                rosterId,
                teamName: leagueConfig.teamName, // This would need roster metadata for team names
                username: (sourceUser as any)?.display_name || 'Unknown'
              }
            };
          });

          // Process FAAB budget
          const faabSpent = Object.entries(transaction.waiver_budget || {}).map(([rosterId, amount]) => {
            const roster = rosters.find(r => r.roster_id === parseInt(rosterId));
            const user = roster ? userMap.get(roster.owner_id) : null;
            
            return {
              rosterId: parseInt(rosterId),
              username: (user as any)?.display_name || 'Unknown',
              amount: Number(amount)
            };
          });

          return {
            transactionId: transaction.transaction_id,
            type: transaction.type,
            status: transaction.status,
            week: transaction.week,
            created: new Date(transaction.created).toISOString(),
            createdBy: {
              username: (creator as any)?.display_name || 'Unknown',
              rosterId: creatorRoster?.roster_id || null
            },
            adds: adds,
            drops: drops,
            faabSpent: faabSpent,
            totalFaabSpent: faabSpent.reduce((sum, f) => sum + f.amount, 0),
            rosterIds: transaction.roster_ids || [],
            metadata: {
              isWaiverClaim: transaction.type === 'waiver',
              isTrade: transaction.type === 'trade',
              isFreeAgent: transaction.type === 'free_agent',
              playerCount: (transaction.adds ? Object.keys(transaction.adds).length : 0) +
                          (transaction.drops ? Object.keys(transaction.drops).length : 0)
            }
          };
        })
        .sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime())
        .slice(0, limit);

      const result = {
        league: args.league || config.defaultLeague,
        week: includeAllWeeks ? 'All weeks' : week,
        transactionType: transactionType,
        totalTransactions: formattedTransactions.length,
        timeRange: {
          includeAllWeeks: includeAllWeeks,
          requestedWeek: week
        },
        transactions: formattedTransactions,
        summary: {
          byType: this.getTransactionTypeSummary(formattedTransactions),
          totalFaabSpent: formattedTransactions.reduce((sum, t) => sum + t.totalFaabSpent, 0),
          mostActiveUsers: this.getMostActiveUsers(formattedTransactions),
          recentActivity: formattedTransactions.slice(0, 5).map(t => ({
            type: t.type,
            playerNames: [...t.adds.map(a => a.playerName), ...t.drops.map(d => d.playerName)],
            username: t.createdBy.username,
            timeAgo: this.getTimeAgo(t.created)
          }))
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
      throw new Error(`Failed to get league transactions: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private getCurrentWeek(): number {
    const now = new Date();
    const seasonStart = new Date('2024-09-05');
    const weeksSinceStart = Math.floor((now.getTime() - seasonStart.getTime()) / (7 * 24 * 60 * 60 * 1000));
    return Math.max(1, Math.min(18, weeksSinceStart + 1));
  }

  private getTransactionTypeSummary(transactions: any[]): Record<string, number> {
    return transactions.reduce((summary, transaction) => {
      summary[transaction.type] = (summary[transaction.type] || 0) + 1;
      return summary;
    }, {});
  }

  private getMostActiveUsers(transactions: any[]): Array<{username: string, transactionCount: number}> {
    const userActivity = transactions.reduce((activity, transaction) => {
      const username = transaction.createdBy.username;
      activity[username] = (activity[username] || 0) + 1;
      return activity;
    }, {} as Record<string, number>);

    return Object.entries(userActivity)
      .map(([username, count]) => ({ username, transactionCount: Number(count) }))
      .sort((a, b) => b.transactionCount - a.transactionCount)
      .slice(0, 5);
  }

  private getTimeAgo(dateString: string): string {
    const now = new Date();
    const past = new Date(dateString);
    const diffMs = now.getTime() - past.getTime();
    
    const minutes = Math.floor(diffMs / (1000 * 60));
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (minutes < 60) return `${minutes} minutes ago`;
    if (hours < 24) return `${hours} hours ago`;
    return `${days} days ago`;
  }
}