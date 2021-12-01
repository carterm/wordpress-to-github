// @ts-check
const { SyncEndpoint } = require("@cagov/wordpress-to-github");
const {
  GitHubCommitter,
  GitHubCredentials,
  SourceEndpointConfigData
} = require("@cagov/wordpress-to-github/common");
const SlackBot = require("@cagov/slack-connector");
const debugChannel = "C01DBP67MSQ"; // #testingbot
//const debugChannel = 'C01H6RB99E2'; //Carter debug
const endPointsJson = require("./endpoints.json");
/** @type {SourceEndpointConfigData[]} */
const endpoints = endPointsJson.data.projects;
/** @type {GitHubCommitter} **/
const gitHubCommitter = {
  name: `${process.env["GITHUB_NAME"]}`,
  email: `${process.env["GITHUB_EMAIL"]}`
};
/** @type {GitHubCredentials} **/
const gitHubCredentials = {
  token: `${process.env["GITHUB_TOKEN"]}`
};

const slackBotGetToken = () => {
  const token = process.env["SLACKBOT_TOKEN"];

  if (!token) {
    //developers that don't set the creds can still use the rest of the code
    console.error(
      `You need local.settings.json to contain "SLACKBOT_TOKEN" to use slackbot features.`
    );
    return;
  }

  return token;
};

/**
 *
 * @param {{executionContext:{functionName:string}}} context
 * @param {*} [myTimer]
 * @param {string[]} [activeEndpoints] list of endpoints to run
 */
module.exports = async function (context, myTimer, activeEndpoints) {
  const endpointsFiltered = [...endpoints].filter(
    x => !activeEndpoints?.length || activeEndpoints.includes(x.name)
  );

  const debugMode = process.env.debug?.toLowerCase() === "true";

  const work = endpointsFiltered.filter(
    x => (debugMode && x.enabledLocal) || (!debugMode && x.enabled)
  );

  if (debugMode) {
    await doProcessEndpoints(work);
    return;
  }

  try {
    await doProcessEndpoints(work);
  } catch (e) {
    const slackBot = new SlackBot(slackBotGetToken(), debugChannel);
    await slackBot.Error(e, myTimer);
  }
};

/**
 *
 * @param {SourceEndpointConfigData[]} work
 */
const doProcessEndpoints = async work => {
  if (work.length) {
    console.log(`Using ${work.length} endpoint(s)`);
  } else {
    console.error(
      `No endpoints selected.  For debug mode you should set at least one "enabledLocal" to true.`
    );
  }

  for (const endpoint of work) {
    console.log(`*** Checking endpoint for ${endpoint.name} ***`);

    const commitReports = await SyncEndpoint(
      endpoint.GitHubTarget,
      endpoint,
      gitHubCredentials,
      gitHubCommitter
    );

    if (endpoint.ReportingChannel_Slack && slackBotGetToken()) {
      //Endpoint reporting channel enabled.  Add a post for each commit report.
      if (commitReports?.length) {
        let opCount = 0;

        /** @type {string[]} */
        let mergeFileNames = [];
        commitReports.forEach(x => {
          opCount += x.Files.length;

          mergeFileNames.push(
            ...x.Files.map(
              //Remove file extension, and remove resolution postfix
              f =>
                f.filename
                  .split("/")
                  .slice(-1)[0]
                  .split(".")[0]
                  .replace(/-\d{1,4}x\d{1,4}$/, "")
            )
          );
        });

        const slackBot = new SlackBot(
          slackBotGetToken(),
          endpoint.ReportingChannel_Slack,
          { username: endpoint.name }
        );

        const slugs = [...new Set(mergeFileNames)];

        let slackMessage = `${opCount} changes. _${slugs.join(", ")}_`;
        if (slackMessage.length > 300) {
          slackMessage = `${opCount} changes.`;
        }

        await slackBot.Chat(slackMessage);

        for (const commitReport of commitReports) {
          const fileData = commitReport.Files.map(
            x => `• ${x.status} - _${x.filename.split("/").slice(-1)[0]}_`
          ).join("\n");

          await slackBot.Reply(
            `<${commitReport.Commit.html_url}|${
              commitReport.Commit.message
            }>\n${
              commitReport.Files.length > 1
                ? `${commitReport.Files.length} changes\n`
                : ""
            }${fileData}`
          );
        }
      }
    }
  }
};
