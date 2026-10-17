import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { invokeArgsSchemas, type InvokeChannel, type InvokeContract } from '@shared/ipc'

type Handler<K extends InvokeChannel> = (
  ...args: InvokeContract[K]['args']
) => InvokeContract[K]['result'] | Promise<InvokeContract[K]['result']>

export type InvokeHandlers = { [K in InvokeChannel]: Handler<K> }

/**
 * Registers every invoke channel. Each call is rejected unless it comes from our own renderer
 * frame, and its arguments are validated against the shared zod schema before the handler runs.
 */
export function registerIpcHandlers(
  handlers: InvokeHandlers,
  isTrustedSender: (url: string) => boolean,
): void {
  for (const channel of Object.keys(handlers) as InvokeChannel[]) {
    ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      const url = event.senderFrame?.url
      if (url === undefined || !isTrustedSender(url)) {
        throw new Error(`Rejected IPC "${channel}" from untrusted sender`)
      }
      const parsed = invokeArgsSchemas[channel].parse(args)
      const handler = handlers[channel] as (...a: unknown[]) => unknown
      return handler(...parsed)
    })
  }
}
