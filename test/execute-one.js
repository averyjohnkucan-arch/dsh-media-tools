// Exercise the actual DSH 0.2.2 batch executor while keeping test calls concise.
export async function executeOne(ctx, {name, arguments: args, callId, signal, agent}) {
 const batch = await ctx.tools.execute({calls:[{type:'tool-call', id:callId, name, arguments:JSON.stringify(args)}], signal, ...(agent?{agent}:{})});
 return batch.results[0].result;
}
